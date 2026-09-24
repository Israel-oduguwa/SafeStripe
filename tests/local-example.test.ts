import test from 'node:test';
import assert from 'node:assert/strict';
import { getLocalRuntime, authenticateLocal } from '../examples/local/runtime.js';
import { stripe, signed, event, secret } from './helpers.js';

test('local starter binds a checkout, verifies payment and commits one fulfillment intent', async (t) => {
  const settings = {
    NODE_ENV: 'test',
    BILLING_DATABASE: 'sqlite',
    SQLITE_PATH: ':memory:',
    STRIPE_SECRET_KEY: 'sk_test_' + 'offlineOnlyFixture',
    STRIPE_ACCOUNT_ID: 'acct_example',
    STRIPE_WEBHOOK_SECRET: secret,
    APP_ORIGIN: 'http://localhost:3000',
    DEMO_TOKEN: 'local-demo-' + 'x'.repeat(32),
    DEMO_CUSTOMER_ID: 'cus_example',
    DEMO_PRICE_ID: 'price_example',
    DEMO_ORDER_ID: 'local-order',
  };
  const previous = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  Object.assign(process.env, settings);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  assert.throws(() => authenticateLocal('wrong', 'http://localhost:3000'), { code: 'FORBIDDEN' });
  assert.throws(() => authenticateLocal(`Bearer ${settings.DEMO_TOKEN}`, 'https://other.example'), {
    code: 'FORBIDDEN',
  });
  authenticateLocal(`Bearer ${settings.DEMO_TOKEN}`, 'http://localhost:3000');
  const r = await getLocalRuntime();
  t.after(() => r.storage.close());
  const session = {
    id: 'cs_local',
    object: 'checkout.session',
    customer: 'cus_example',
    mode: 'payment',
    client_reference_id: 'local-order',
    status: 'complete',
    payment_status: 'paid',
    url: 'https://checkout.stripe.com/example',
    client_secret: null,
  };
  const create = t.mock.method(r.billing.stripe.checkout.sessions, 'create', async () => session);
  t.mock.method(r.billing.stripe.checkout.sessions, 'retrieve', async () => session);
  const lines = t.mock.method(r.billing.stripe.checkout.sessions, 'listLineItems', async () => ({
    has_more: false,
    data: [{ price: { id: 'price_wrong' }, quantity: 1 }],
  }));
  const first = await r.createCheckout();
  const replay = await r.createCheckout();
  assert.equal(first.id, replay.id);
  assert.equal(create.mock.callCount(), 1);
  assert.equal(await r.status(), 'pending');
  const invalid = signed(event('evt_badterms', { data: { object: { id: 'cs_local' } } }));
  await r.receiver.receive(invalid.raw, invalid.signature);
  assert.equal(await r.worker.runOnce(), 'failed');
  assert.equal(await r.status(), 'pending');
  lines.mock.mockImplementation(async () => ({
    has_more: false,
    data: [{ price: { id: 'price_example' }, quantity: 1 }],
  }));
  for (const id of ['evt_paid1', 'evt_paid2']) {
    const fixture = signed(event(id, { data: { object: { id: 'cs_local' } } }));
    await r.receiver.receive(fixture.raw, fixture.signature);
    assert.equal(await r.worker.runOnce(), 'done');
  }
  assert.equal(await r.status(), 'fulfilled');
  const receipt = await r.storage.jobs.inspect(
    'outbox',
    r.billing.scopeId,
    'receipt:demo-tenant:local-order',
  );
  assert.equal(receipt?.state, 'pending');
  assert.deepEqual(receipt?.payload, { orderId: 'local-order' });
  await assert.rejects(r.createCheckout('custom'), { code: 'PAYLOAD_CONFLICT' });
});
