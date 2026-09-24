import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type Stripe from 'stripe';
import {
  PostgresOperations,
  SafeStripe,
  scopeKey,
  digest,
  idempotencyKey,
  ConcurrencyGate,
} from '../src/index.js';
import { actor, scope, testDatabase } from './helpers.js';

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
const op = () => ({
  scope: scopeKey(scope),
  tenantId: actor.tenantId,
  operationId: actor.operationId,
  kind: 'payment.create',
  fingerprint: digest({ amount: 500 }),
  key: idempotencyKey(scopeKey(scope), actor, 'payment.create'),
});

test('operation claims are atomic under competing requests', async () => {
  const store = new PostgresOperations(harness.db);
  const outcomes = await Promise.allSettled(Array.from({ length: 10 }, () => store.claim(op())));
  assert.equal(outcomes.filter((x) => x.status === 'fulfilled').length, 1);
  for (const outcome of outcomes)
    if (outcome.status === 'rejected') assert.equal(outcome.reason.code, 'BUSY');
});
test('changed payload or operation kind conflicts even after success', async () => {
  const store = new PostgresOperations(harness.db);
  const claim = await store.claim(op());
  assert.ok(!claim.replay);
  await store.succeed(op(), claim.token, 'pi_1');
  await assert.rejects(store.claim({ ...op(), fingerprint: 'different' }), {
    code: 'PAYLOAD_CONFLICT',
  });
  await assert.rejects(store.claim({ ...op(), kind: 'refund.create' }), {
    code: 'PAYLOAD_CONFLICT',
  });
  assert.deepEqual(await store.claim(op()), { replay: true, resourceId: 'pi_1' });
});
test('identical purchase data with different business IDs stays distinct', async () => {
  assert.notEqual(
    idempotencyKey(scopeKey(scope), actor, 'checkout.create'),
    idempotencyKey(scopeKey(scope), { ...actor, operationId: 'order-2' }, 'checkout.create'),
  );
  assert.notEqual(
    idempotencyKey(scopeKey(scope), actor, 'checkout.create'),
    idempotencyKey(
      scopeKey({ ...scope, connectedAccountId: 'acct_seller' }),
      actor,
      'checkout.create',
    ),
  );
});
test('an ambiguous operation beyond the retry window enters durable review', async () => {
  const store = new PostgresOperations(harness.db);
  await store.claim(op());
  await harness.db.query(
    "UPDATE sf_operations SET created_at=clock_timestamp()-interval '24 hours', lease_until=clock_timestamp()-interval '1 second'",
  );
  await assert.rejects(store.claim(op()), { code: 'REVIEW_REQUIRED' });
  assert.equal(
    (await harness.db.query('SELECT state FROM sf_operations')).rows[0]!.state,
    'review',
  );
  await store.resolveForReview(
    op(),
    'pi_recovered',
    'finance-lead',
    'Verified Stripe request history and resource ownership',
  );
  assert.deepEqual(await store.claim(op()), { replay: true, resourceId: 'pi_recovered' });
  assert.equal((await harness.db.query('SELECT count(*)::int AS n FROM sf_audit')).rows[0]!.n, 1);
});
test('stale owners cannot overwrite a recovered operation', async () => {
  const store = new PostgresOperations(harness.db);
  const first = await store.claim(op());
  assert.ok(!first.replay);
  await harness.db.query(
    "UPDATE sf_operations SET lease_until=clock_timestamp()-interval '1 second'",
  );
  const second = await store.claim(op());
  assert.ok(!second.replay);
  await assert.rejects(store.succeed(op(), first.token, 'pi_wrong'), { code: 'LEASE_LOST' });
  await store.retry(op(), first.token);
  await store.succeed(op(), second.token, 'pi_right');
  assert.deepEqual(await store.claim(op()), { replay: true, resourceId: 'pi_right' });
});
test('tenant isolation allows the same business ID in different tenants', async () => {
  const store = new PostgresOperations(harness.db);
  await store.claim(op());
  assert.equal((await store.claim({ ...op(), tenantId: 'tenant-b', key: 'key-b' })).replay, false);
});
test('gateway authorizes every replay and reuses the same key after a lost response', async () => {
  let calls = 0,
    retrieves = 0,
    allowed = true;
  const keys: string[] = [];
  const sdk = {
    paymentIntents: {
      async create(_params: unknown, options: Stripe.RequestOptions) {
        keys.push(options.idempotencyKey!);
        if (++calls === 1) throw new Error('connection lost');
        return { id: 'pi_1' };
      },
      async retrieve(id: string, _params: unknown, options: Stripe.RequestOptions) {
        retrieves++;
        assert.equal(options.stripeAccount, 'acct_seller');
        return { id };
      },
    },
  } as unknown as Stripe;
  const client = new SafeStripe({
    stripe: sdk,
    scope: { ...scope, connectedAccountId: 'acct_seller' },
    operations: new PostgresOperations(harness.db),
    authorize: async () => allowed,
    appOrigin: 'https://shop.example',
  });
  const input = { customerId: 'cus_1', amount: 1000, currency: 'usd' };
  await assert.rejects(client.createPaymentIntent(actor, input), { code: 'UPSTREAM_FAILED' });
  assert.equal((await client.createPaymentIntent(actor, input)).id, 'pi_1');
  assert.equal((await client.createPaymentIntent(actor, input)).id, 'pi_1');
  assert.equal(keys[0], keys[1]);
  assert.equal(calls, 2);
  assert.equal(retrieves, 1);
  allowed = false;
  await assert.rejects(client.createPaymentIntent(actor, input), { code: 'FORBIDDEN' });
  assert.equal(retrieves, 1);
});
test('gateway rejects fractional money, extra fields and untrusted redirect origins', async () => {
  const config = {
    stripe: {} as Stripe,
    scope,
    operations: new PostgresOperations(harness.db),
    authorize: async () => true,
    appOrigin: 'https://shop.example',
  };
  const client = new SafeStripe(config);
  await assert.rejects(
    client.createPaymentIntent(actor, { customerId: 'cus_1', amount: 1.5, currency: 'usd' }),
    { code: 'INVALID_INPUT' },
  );
  await assert.rejects(
    client.createCustomer(actor, { email: 'user@example.com', ...{ metadata: { admin: true } } }),
    { code: 'INVALID_INPUT' },
  );
  assert.throws(() => new SafeStripe({ ...config, appOrigin: 'https://user:secret@shop.example' }));
  assert.throws(
    () => new SafeStripe({ ...config, appOrigin: 'http://example.com', allowLocalhost: true }),
  );
});
test('canonical hashing ignores object key order but rejects undefined', () => {
  assert.equal(digest({ a: 1, b: 2 }), digest({ b: 2, a: 1 }));
  assert.throws(() => digest({ amount: undefined }));
});
test('bounded concurrency rejects overload and releases capacity after failure', async () => {
  const gate = new ConcurrencyGate(1, 0);
  let release!: () => void;
  const first = gate.run(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await assert.rejects(
    gate.run(async () => {}),
    { code: 'BUSY' },
  );
  release();
  await first;
  await assert.rejects(
    gate.run(async () => {
      throw new Error('failure');
    }),
  );
  assert.equal(await gate.run(async () => 42), 42);
});
