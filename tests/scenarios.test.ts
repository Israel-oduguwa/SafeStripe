import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import Stripe from 'stripe';
import { SafeStripe, API_VERSION } from '../src/index.js';
import { sqliteStorage } from '../src/storage/sqlite.js';
import { actor, scope } from './helpers.js';

test('scenario methods use the real SDK, stable writes and retrieval on retry', async (t) => {
  const requests: { method: string; path: string; body: string; key?: string }[] = [];
  const server = createServer(async (req, res) => {
    const buffers: Buffer[] = [];
    for await (const chunk of req) buffers.push(Buffer.from(chunk));
    requests.push({
      method: req.method!,
      path: req.url!,
      body: Buffer.concat(buffers).toString(),
      key: req.headers['idempotency-key'] as string,
    });
    let body: unknown = { id: 'fixture_id', object: 'fixture', status: 'active' };
    if (req.url?.startsWith('/v1/billing/meters/mtr_'))
      body = {
        id: 'mtr_fixture',
        status: 'active',
        event_name: 'api_calls',
        default_aggregation: { formula: 'sum' },
        customer_mapping: { event_payload_key: 'stripe_customer_id' },
        value_settings: { event_payload_key: 'value' },
        event_time_window: null,
      };
    if (req.url?.startsWith('/v2/core/accounts/acct_'))
      body = {
        id: 'acct_recipient',
        configuration: {
          recipient: {
            capabilities: { stripe_balance: { stripe_transfers: { status: 'active' } } },
          },
        },
      };
    if (req.url?.startsWith('/v1/charges/ch_'))
      body = {
        id: 'ch_paid',
        paid: true,
        disputed: false,
        amount: 5000,
        amount_refunded: 0,
        currency: 'usd',
        livemode: false,
      };
    if (req.url?.startsWith('/v1/invoices/in_'))
      body = { id: 'in_open', status: 'open', amount_remaining: 5000 };
    if (req.url?.startsWith('/v1/tax/settings')) body = { status: 'active' };
    if (req.url?.startsWith('/v1/tax/registrations'))
      body = { data: [{ id: 'taxreg_one' }], has_more: false };
    res.writeHead(200, { 'content-type': 'application/json', 'request-id': 'req_fixture' });
    res.end(JSON.stringify(body));
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const stripe = new Stripe('sk_test_' + 'OfflineFixture', {
    host: '127.0.0.1',
    port: address.port,
    protocol: 'http',
    apiVersion: API_VERSION,
    maxNetworkRetries: 0,
  });
  const storage = await sqliteStorage({ filename: ':memory:' });
  t.after(() => storage.close());
  const approvals: { action: string; resources: readonly { kind: string; id: string }[] }[] = [];
  const billing = new SafeStripe({
    stripe,
    scope,
    operations: storage.operations,
    appOrigin: 'https://example.com',
    authorize: async (p) => {
      approvals.push(p);
      return true;
    },
  });
  const now = Math.floor(Date.now() / 1000);
  const cases: [string, (a: typeof actor) => Promise<unknown>, string, Record<string, string>][] = [
    [
      'multi',
      (a) =>
        billing.createMultiItemSubscription(a, {
          customerId: 'cus_one',
          items: [{ priceId: 'price_seats', quantity: 5 }, { priceId: 'price_usage' }],
          trialDays: 14,
          promotionCodeId: 'promo_one',
        }),
      '/v1/subscriptions',
      {
        'items[0][quantity]': '5',
        'items[1][price]': 'price_usage',
        'trial_settings[end_behavior][missing_payment_method]': 'pause',
        'discounts[0][promotion_code]': 'promo_one',
      },
    ],
    [
      'setup',
      (a) =>
        billing.createSetupCheckout(a, {
          customerId: 'cus_one',
          reference: 'save-card',
          currency: 'usd',
        }),
      '/v1/checkout/sessions',
      {
        mode: 'setup',
        success_url: 'https://example.com/success?session_id={CHECKOUT_SESSION_ID}',
      },
    ],
    [
      'intent',
      (a) => billing.createSetupIntent(a, { customerId: 'cus_one' }),
      '/v1/setup_intents',
      { usage: 'off_session', 'automatic_payment_methods[enabled]': 'true' },
    ],
    [
      'link',
      (a) => billing.createPaymentLink(a, { priceId: 'price_one', quantity: 2 }),
      '/v1/payment_links',
      { 'line_items[0][quantity]': '2' },
    ],
    [
      'pause',
      (a) =>
        billing.setSubscriptionCollection(a, {
          subscriptionId: 'sub_one',
          behavior: 'keep_as_draft',
        }),
      '/v1/subscriptions/sub_one',
      { 'pause_collection[behavior]': 'keep_as_draft' },
    ],
    [
      'collect',
      (a) =>
        billing.setSubscriptionCollection(a, { subscriptionId: 'sub_one', behavior: 'collect' }),
      '/v1/subscriptions/sub_one',
      { pause_collection: '' },
    ],
    [
      'restore',
      (a) => billing.restoreSubscription(a, { subscriptionId: 'sub_one' }),
      '/v1/subscriptions/sub_one',
      { cancel_at_period_end: 'false' },
    ],
    [
      'resume',
      (a) => billing.resumePausedSubscription(a, { subscriptionId: 'sub_one' }),
      '/v1/subscriptions/sub_one/resume',
      { billing_cycle_anchor: 'now' },
    ],
    [
      'tiered',
      (a) =>
        billing.createTieredPrice(a, {
          productId: 'prod_one',
          currency: 'usd',
          interval: 'month',
          mode: 'graduated',
          tiers: [
            { upTo: 10, unitAmount: 1000 },
            { upTo: 'inf', unitAmount: 800 },
          ],
        }),
      '/v1/prices',
      { billing_scheme: 'tiered', tiers_mode: 'graduated', 'tiers[1][up_to]': 'inf' },
    ],
    [
      'schedule',
      (a) =>
        billing.createSchedule(a, {
          customerId: 'cus_one',
          startAt: now + 86400,
          endBehavior: 'release',
          daysUntilDue: 30,
          phases: [
            { months: 3, items: [{ priceId: 'price_one', quantity: 1 }] },
            { months: 9, items: [{ priceId: 'price_two', quantity: 1 }] },
          ],
        }),
      '/v1/subscription_schedules',
      {
        'phases[0][duration][interval_count]': '3',
        'default_settings[collection_method]': 'send_invoice',
      },
    ],
    [
      'quote',
      (a) =>
        billing.createQuote(a, {
          customerId: 'cus_one',
          items: [{ priceId: 'price_one', quantity: 1 }],
          daysUntilDue: 30,
        }),
      '/v1/quotes',
      { collection_method: 'send_invoice' },
    ],
    [
      'qfinal',
      (a) => billing.finalizeQuote(a, { quoteId: 'qt_one' }),
      '/v1/quotes/qt_one/finalize',
      {},
    ],
    [
      'qaccept',
      (a) => billing.acceptQuote(a, { quoteId: 'qt_one' }),
      '/v1/quotes/qt_one/accept',
      {},
    ],
    [
      'credit',
      (a) =>
        billing.createCreditNote(a, {
          invoiceId: 'in_open',
          amount: 100,
          memo: 'Agreed adjustment',
        }),
      '/v1/credit_notes',
      { amount: '100' },
    ],
    [
      'balance',
      (a) =>
        billing.adjustCustomerBalance(a, {
          customerId: 'cus_one',
          amount: -100,
          currency: 'usd',
          description: 'Service credit',
        }),
      '/v1/customers/cus_one/balance_transactions',
      { amount: '-100' },
    ],
    [
      'meter',
      (a) => billing.createMeter(a, { eventName: 'api_calls', displayName: 'API calls' }),
      '/v1/billing/meters',
      { 'default_aggregation[formula]': 'sum' },
    ],
    [
      'usage',
      (a) =>
        billing.recordUsage(a, {
          customerId: 'cus_one',
          meterId: 'mtr_fixture',
          value: 25,
          timestamp: now,
        }),
      '/v1/billing/meter_events',
      { 'payload[value]': '25', 'payload[stripe_customer_id]': 'cus_one' },
    ],
    [
      'clock',
      (a) => billing.createTestClock(a, { name: 'Renewals', frozenTime: now }),
      '/v1/test_helpers/test_clocks',
      { frozen_time: String(now) },
    ],
    [
      'advance',
      (a) => billing.advanceTestClock(a, { clockId: 'clock_one', frozenTime: now + 86400 }),
      '/v1/test_helpers/test_clocks/clock_one/advance',
      {},
    ],
    [
      'clockcustomer',
      (a) => billing.createClockCustomer(a, { clockId: 'clock_one', email: 'test@example.com' }),
      '/v1/customers',
      { test_clock: 'clock_one' },
    ],
    [
      'account',
      (a) =>
        billing.createMarketplaceAccount(a, {
          email: 'test@example.com',
          country: 'US',
          displayName: 'Test seller',
        }),
      '/v2/core/accounts',
      {},
    ],
    [
      'transfer',
      (a) =>
        billing.createTransfer(a, {
          accountId: 'acct_recipient',
          chargeId: 'ch_paid',
          amount: 4000,
          currency: 'usd',
          group: 'order-1',
        }),
      '/v1/transfers',
      { source_transaction: 'ch_paid', amount: '4000', transfer_group: 'order-1' },
    ],
    [
      'reverse',
      (a) => billing.reverseTransfer(a, { transferId: 'tr_one', amount: 4000 }),
      '/v1/transfers/tr_one/reversals',
      { amount: '4000' },
    ],
    [
      'identity',
      (a) => billing.createIdentitySession(a, { reference: 'user-1' }),
      '/v1/identity/verification_sessions',
      { type: 'document', return_url: 'https://example.com/identity/return' },
    ],
    [
      'checkouttax',
      (a) =>
        billing.createCheckout(a, {
          customerId: 'cus_one',
          mode: 'subscription',
          items: [{ priceId: 'price_usage' }],
          reference: 'order-1',
          trialDays: 7,
          automaticTax: true,
          allowPromotionCodes: true,
        }),
      '/v1/checkout/sessions',
      { 'automatic_tax[enabled]': 'true', 'subscription_data[trial_period_days]': '7' },
    ],
  ];
  for (const [name, invoke, path, expected] of cases)
    await t.test(name, async () => {
      const a = { ...actor, operationId: `scenario-${name}` };
      const offset = requests.length;
      await invoke(a);
      await invoke(a);
      const posts = requests.slice(offset).filter((r) => r.method === 'POST');
      assert.equal(posts.length, 1, `${name} must mutate once`);
      assert.equal(posts[0]!.path, path);
      assert.match(posts[0]!.key!, /^sf_v1_[a-f0-9]{64}$/);
      if (name === 'account') {
        const body = JSON.parse(posts[0]!.body);
        assert.equal(body.dashboard, 'express');
        assert.equal(body.defaults.responsibilities.losses_collector, 'application');
        assert.equal(
          body.configuration.recipient.capabilities.stripe_balance.stripe_transfers.requested,
          true,
        );
      } else {
        const body = new URLSearchParams(posts[0]!.body);
        for (const [k, v] of Object.entries(expected)) assert.equal(body.get(k), v, k);
        assert.equal(body.get('payment_method_types[0]'), null);
        if (name === 'multi') assert.equal(body.get('items[1][quantity]'), null);
        if (name === 'usage') assert.equal(body.get('identifier'), posts[0]!.key);
        if (name === 'transfer') assert.equal(body.get('application_fee_amount'), null);
      }
    });
  assert.ok(
    approvals.some((p) => p.resources.some((r) => r.kind === 'charge' && r.id === 'ch_paid')),
  );
  assert.equal((await billing.inspectTaxSetup(actor)).readyForCalculation, true);
  await billing.createOnboardingLink(actor, { accountId: 'acct_recipient' });
  const link = JSON.parse(requests.at(-1)!.body);
  assert.equal(link.use_case.account_onboarding.refresh_url, 'https://example.com/connect/refresh');
});

test('validation, authorization, payload conflict and live-mode gates prevent new writes', async (t) => {
  const storage = await sqliteStorage({ filename: ':memory:' });
  t.after(() => storage.close());
  let calls = 0;
  const stripe = {
    setupIntents: {
      create: async () => {
        calls++;
        return { id: 'seti_one' };
      },
      retrieve: async () => ({ id: 'seti_one' }),
    },
  } as unknown as Stripe;
  const make = (allow = true, livemode = false) =>
    new SafeStripe({
      stripe,
      scope: { ...scope, livemode },
      operations: storage.operations,
      appOrigin: 'https://example.com',
      authorize: async () => allow,
    });
  await assert.rejects(make(false).createSetupIntent(actor, { customerId: 'cus_one' }), {
    code: 'FORBIDDEN',
  });
  await assert.rejects(
    make().createSetupIntent(actor, {
      customerId: 'cus_one',
      returnUrl: 'https://evil.invalid',
    } as never),
    { code: 'INVALID_INPUT' },
  );
  await assert.rejects(make(true, true).createTestClock(actor, { name: 'no', frozenTime: 123 }), {
    code: 'FORBIDDEN',
  });
  await assert.rejects(
    make().createTieredPrice(actor, {
      productId: 'prod_one',
      currency: 'usd',
      interval: 'month',
      mode: 'volume',
      tiers: [
        { upTo: 10, unitAmount: 10 },
        { upTo: 5, unitAmount: 1 },
      ],
    }),
    { code: 'INVALID_INPUT' },
  );
  assert.equal(calls, 0);
  await make().createSetupIntent(actor, { customerId: 'cus_one' });
  await assert.rejects(make().createSetupIntent(actor, { customerId: 'cus_two' }), {
    code: 'PAYLOAD_CONFLICT',
  });
  assert.equal(calls, 1);
});

test('transfers and credits fail closed when their financial preconditions are missing', async (t) => {
  const storage = await sqliteStorage({ filename: ':memory:' });
  t.after(() => storage.close());
  let mutations = 0;
  const stripe = {
    v2: { core: { accounts: { retrieve: async () => ({ configuration: {} }) } } },
    transfers: {
      create: async () => {
        mutations++;
      },
    },
    invoices: { retrieve: async () => ({ status: 'paid', amount_remaining: 0 }) },
    creditNotes: {
      create: async () => {
        mutations++;
      },
    },
    tax: {
      settings: { retrieve: async () => ({ status: 'pending' }) },
      registrations: { list: async () => ({ data: [] }) },
    },
    checkout: {
      sessions: {
        create: async () => {
          mutations++;
        },
      },
    },
  } as unknown as Stripe;
  const billing = new SafeStripe({
    stripe,
    scope,
    operations: storage.operations,
    appOrigin: 'https://example.com',
    authorize: async () => true,
  });
  await assert.rejects(
    billing.createTransfer(actor, {
      accountId: 'acct_one',
      chargeId: 'ch_one',
      amount: 100,
      currency: 'usd',
      group: 'order-1',
    }),
    { code: 'INVALID_INPUT' },
  );
  await assert.rejects(
    billing.createCreditNote(
      { ...actor, operationId: 'credit' },
      { invoiceId: 'in_one', amount: 100, memo: 'Adjustment' },
    ),
    { code: 'INVALID_INPUT' },
  );
  await assert.rejects(
    billing.createCheckout(
      { ...actor, operationId: 'tax' },
      {
        customerId: 'cus_one',
        mode: 'payment',
        items: [{ priceId: 'price_one', quantity: 1 }],
        reference: 'order-1',
        automaticTax: true,
      },
    ),
    { code: 'INVALID_INPUT' },
  );
  assert.equal(mutations, 0);
});
