import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { PostgresJobs, WebhookReceiver, API_VERSION } from '../src/index.js';
import { nextWebhook, boundedBody } from '../src/adapters/next.js';
import { expressWebhook } from '../src/adapters/express.js';
import { event, scope, secret, signed, stripe, testDatabase } from './helpers.js';
let harness: Awaited<ReturnType<typeof testDatabase>>;
before(async () => {
  harness = await testDatabase();
});
after(async () => {
  await harness.close();
});
beforeEach(async () => {
  await harness.reset();
});
const receiver = (secrets = [secret]) =>
  new WebhookReceiver({
    stripe,
    scope,
    jobs: new PostgresJobs(harness.db),
    signingSecrets: secrets,
    eventTypes: ['checkout.session.completed'],
  });
const req = (raw: Buffer, signature: string) =>
  new Request('https://shop.example/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    body: new Uint8Array(raw),
  });

test('valid signature admits once and acknowledges duplicates', async () => {
  const r = receiver();
  const { raw, signature } = signed();
  assert.deepEqual(await r.receive(raw, signature), { received: true, duplicate: false });
  assert.deepEqual(await r.receive(raw, signature), { received: true, duplicate: true });
});
test('tampering, missing signatures and old signatures never enter the inbox', async () => {
  const r = receiver();
  const { raw, signature } = signed();
  await assert.rejects(r.receive(Buffer.concat([raw, Buffer.from(' ')]), signature), {
    code: 'INVALID_WEBHOOK',
  });
  await assert.rejects(r.receive(raw, undefined), { code: 'INVALID_WEBHOOK' });
  const old = signed(event(), secret, Math.floor(Date.now() / 1000) - 600);
  await assert.rejects(r.receive(old.raw, old.signature), { code: 'INVALID_WEBHOOK' });
  assert.equal((await harness.db.query('SELECT count(*)::int AS n FROM sf_jobs')).rows[0]!.n, 0);
});
test('rotating webhook secrets accepts both within configured overlap', async () => {
  const nextSecret = 'whsec_' + 'newOfflineFixture';
  const r = receiver([nextSecret, secret]);
  for (const value of [signed(), signed(event('evt_2'), nextSecret)])
    assert.equal((await r.receive(value.raw, value.signature)).received, true);
});
for (const [name, overrides] of Object.entries({
  live: { livemode: true },
  account: { account: 'acct_intruder' },
  version: { api_version: '2020-08-27' },
  organization: { context: 'acct_organization' },
  thin: { object: 'event_notification' },
})) {
  test(`signed ${name} event outside the route contract is rejected`, async () => {
    const value = signed(event('evt_1', overrides));
    await assert.rejects(receiver().receive(value.raw, value.signature), {
      code: 'INVALID_WEBHOOK',
    });
  });
}
test('connected-account route accepts only its own account', async () => {
  const r = new WebhookReceiver({
    stripe,
    scope: { ...scope, connectedAccountId: 'acct_seller' },
    jobs: new PostgresJobs(harness.db),
    signingSecrets: [secret],
    eventTypes: ['checkout.session.completed'],
  });
  const valid = signed(event('evt_1', { account: 'acct_seller' }));
  assert.equal((await r.receive(valid.raw, valid.signature)).received, true);
  const invalid = signed();
  await assert.rejects(r.receive(invalid.raw, invalid.signature), { code: 'INVALID_WEBHOOK' });
});
test('ignored event types are authenticated but not enqueued', async () => {
  const value = signed(event('evt_1', { type: 'customer.created' }));
  assert.deepEqual(await receiver().receive(value.raw, value.signature), {
    received: true,
    ignored: true,
  });
});
test('database outage returns a retryable HTTP status, not a successful acknowledgment', async () => {
  const broken = {
    query: async () => {
      throw new Error('private connection details');
    },
    connect: async () => {
      throw new Error('private');
    },
  };
  const r = new WebhookReceiver({
    stripe,
    scope,
    jobs: new PostgresJobs(broken),
    signingSecrets: [secret],
    eventTypes: ['checkout.session.completed'],
  });
  const value = signed();
  const response = await nextWebhook(r)(req(value.raw, value.signature));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'TEMPORARILY_UNAVAILABLE' });
});
test('Next adapter preserves raw bytes and prohibits caching', async () => {
  const value = signed();
  const response = await nextWebhook(receiver())(req(value.raw, value.signature));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('streaming size limit works without content-length and cancels oversized bodies', async () => {
  const request = new Request('https://example.com', {
    method: 'POST',
    body: new Uint8Array(2048),
  });
  await assert.rejects(boundedBody(request, 1024), { code: 'BODY_TOO_LARGE' });
});
test('Next rejects methods, wrong content type, compression and oversized declared length', async () => {
  const handler = nextWebhook(receiver());
  assert.equal((await handler(new Request('https://example.com'))).status, 405);
  assert.equal(
    (await handler(new Request('https://example.com', { method: 'POST', body: '{}' }))).status,
    415,
  );
  assert.equal(
    (
      await handler(
        new Request('https://example.com', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
          body: '{}',
        }),
      )
    ).status,
    415,
  );
  assert.equal(
    (
      await handler(
        new Request('https://example.com', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'content-length': '9999999' },
          body: '{}',
        }),
      )
    ).status,
    413,
  );
});
test('real Express route verifies a signature over the original payload', async () => {
  const r = receiver();
  const app = express();
  app.post(
    '/webhook',
    express.raw({ type: 'application/json', limit: r.maxBytes, inflate: false }),
    expressWebhook(r),
  );
  app.use(express.json());
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const value = signed();
    const response = await fetch(`http://127.0.0.1:${address.port}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': value.signature },
      body: new Uint8Array(value.raw),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { received: true, duplicate: false });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});
test('API version fixture tracks the pinned integration contract', () => {
  assert.equal(API_VERSION, '2026-08-26.dahlia');
});
