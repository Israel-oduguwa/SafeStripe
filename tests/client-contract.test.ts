import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import Stripe from 'stripe';
import {
  SafeStripe,
  PostgresOperations,
  API_VERSION,
  ConcurrencyGate,
  PostgresJobs,
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

test('actual Stripe SDK sends version, account and stable idempotency headers with safe replay', async () => {
  const requests: {
    method: string;
    path: string;
    key: string | undefined;
    version: string | undefined;
    account: string | undefined;
    body: string;
  }[] = [];
  const server = createServer(async (req, res) => {
    const buffers: Buffer[] = [];
    for await (const chunk of req) buffers.push(Buffer.from(chunk));
    requests.push({
      method: req.method!,
      path: req.url!,
      key: req.headers['idempotency-key'] as string | undefined,
      version: req.headers['stripe-version'] as string | undefined,
      account: req.headers['stripe-account'] as string | undefined,
      body: Buffer.concat(buffers).toString(),
    });
    res.writeHead(200, { 'content-type': 'application/json', 'request-id': 'req_offlinefixture' });
    res.end(
      JSON.stringify({
        id: 're_fixture',
        object: 'refund',
        amount: 1000,
        currency: 'usd',
        status: 'succeeded',
      }),
    );
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    // Test-only transport override; production factory only uses Stripe's HTTPS endpoint.
    const sdk = new Stripe('sk_test_' + 'offlineFixture', {
      apiVersion: API_VERSION,
      host: '127.0.0.1',
      port: address.port,
      protocol: 'http',
      maxNetworkRetries: 0,
    });
    const safe = new SafeStripe({
      stripe: sdk,
      scope: { ...scope, connectedAccountId: 'acct_seller' },
      operations: new PostgresOperations(harness.db),
      authorize: async (input) =>
        input.resources[0]?.id === 'pi_1' &&
        (input.parameters as { amount: number }).amount === 1000,
      appOrigin: 'https://shop.example',
    });
    const data = {
      paymentIntentId: 'pi_1',
      amount: 1000,
      reason: 'requested_by_customer' as const,
    };
    assert.equal((await safe.createRefund(actor, data)).id, 're_fixture');
    assert.equal((await safe.createRefund(actor, data)).id, 're_fixture');
    assert.equal(requests.length, 2);
    assert.equal(requests[0]!.method, 'POST');
    assert.equal(requests[1]!.method, 'GET');
    assert.equal(requests[0]!.path, '/v1/refunds');
    assert.equal(requests[1]!.path, '/v1/refunds/re_fixture');
    for (const request of requests) {
      assert.equal(request.version, API_VERSION);
      assert.equal(request.account, 'acct_seller');
    }
    assert.match(requests[0]!.key!, /^sf_v1_[a-f0-9]{64}$/);
    const body = new URLSearchParams(requests[0]!.body);
    assert.equal(body.get('payment_intent'), 'pi_1');
    assert.equal(body.get('amount'), '1000');
    await assert.rejects(
      safe.createRefund({ ...actor, operationId: 'refund-2' }, { ...data, amount: 2000 }),
      { code: 'FORBIDDEN' },
    );
    assert.equal(requests.length, 2);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('checkout parameters have fixed origins, approved prices and no client-controlled method override', async () => {
  let seen: Stripe.Checkout.SessionCreateParams | undefined;
  const sdk = {
    checkout: {
      sessions: {
        async create(params: Stripe.Checkout.SessionCreateParams) {
          seen = params;
          return { id: 'cs_1' };
        },
      },
    },
  } as unknown as Stripe;
  const safe = new SafeStripe({
    stripe: sdk,
    scope,
    operations: new PostgresOperations(harness.db),
    authorize: async () => true,
    appOrigin: 'https://shop.example',
  });
  await safe.createCheckout(actor, {
    customerId: 'cus_1',
    mode: 'payment',
    items: [{ priceId: 'price_1', quantity: 2 }],
    reference: 'order-1',
  });
  assert.equal(seen!.success_url, 'https://shop.example/success?session_id={CHECKOUT_SESSION_ID}');
  assert.deepEqual(seen!.line_items, [{ price: 'price_1', quantity: 2 }]);
  assert.equal(seen!.payment_method_types, undefined);
  assert.equal(seen!.automatic_tax, undefined);
  assert.match(seen!.integration_identifier!, /_[a-z]{8}$/);
});

test('proration preview and update share item, quantity and timestamp', async () => {
  let preview: Stripe.InvoiceCreatePreviewParams | undefined,
    update: Stripe.SubscriptionUpdateParams | undefined;
  const sdk = {
    subscriptions: {
      async retrieve() {
        return { id: 'sub_1', items: { data: [{ id: 'si_1' }] } };
      },
      async update(_id: string, params: Stripe.SubscriptionUpdateParams) {
        update = params;
        return { id: 'sub_1' };
      },
    },
    invoices: {
      async createPreview(params: Stripe.InvoiceCreatePreviewParams) {
        preview = params;
        return { id: 'upcoming_in_1' };
      },
    },
  } as unknown as Stripe;
  const safe = new SafeStripe({
    stripe: sdk,
    scope,
    operations: new PostgresOperations(harness.db),
    authorize: async () => true,
    appOrigin: 'https://shop.example',
  });
  const input = {
    subscriptionId: 'sub_1',
    itemId: 'si_1',
    priceId: 'price_2',
    quantity: 8,
    prorationDate: 1800000000,
  };
  await safe.previewSubscriptionChange(actor, input);
  await safe.updateSubscription(actor, input);
  assert.equal(preview!.subscription_details!.proration_date, update!.proration_date);
  assert.deepEqual(preview!.subscription_details!.items, update!.items);
  assert.equal(update!.payment_behavior, 'pending_if_incomplete');
  await assert.rejects(
    safe.updateSubscription(
      { ...actor, operationId: 'change-2' },
      { ...input, itemId: 'si_foreign' },
    ),
    { code: 'INVALID_INPUT' },
  );
});

test('a local queue wait times out and does not leak a concurrency slot', async () => {
  const gate = new ConcurrencyGate(1, 1, 10);
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
  assert.equal(await gate.run(async () => 7), 7);
});

test('outbox identity cannot silently bind a changed message', async () => {
  const jobs = new PostgresJobs(harness.db);
  await jobs.enqueue('outbox', 'scope', 'message-1', 'receipt', { amount: 1 });
  assert.equal(await jobs.enqueue('outbox', 'scope', 'message-1', 'receipt', { amount: 1 }), false);
  await assert.rejects(jobs.enqueue('outbox', 'scope', 'message-1', 'receipt', { amount: 2 }), {
    code: 'PAYLOAD_CONFLICT',
  });
});
