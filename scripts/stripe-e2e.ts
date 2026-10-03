import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import Stripe from 'stripe';
import { API_VERSION, SafeStripe } from '../src/index.js';
import { sqliteStorage } from '../src/storage/sqlite.js';

// An opt-in service test. Only a disposable sandbox should grant this runner access.
if (process.env.STRIPE_E2E_CONFIRM !== 'disposable-sandbox')
  throw new Error('Set STRIPE_E2E_CONFIRM=disposable-sandbox to permit test-object creation');
const key = process.env.STRIPE_SECRET_KEY ?? '';
if (!/^rk_test_/.test(key)) throw new Error('Provide a restricted sandbox key');
const account = process.env.STRIPE_ACCOUNT_ID ?? '';
if (!/^acct_[A-Za-z0-9]+$/.test(account)) throw new Error('Set the expected sandbox account ID');
const stripe = new Stripe(key, {
  apiVersion: API_VERSION,
  telemetry: false,
  timeout: 15000,
  maxNetworkRetries: 0,
});
assert.equal(
  (await stripe.accounts.retrieve(null)).id,
  account,
  'Key belongs to a different account',
);
const runId = randomUUID();
const email = `safestripe-${runId}@example.invalid`;
const storage = await sqliteStorage({ filename: `./.data/e2e-${runId}.sqlite` });
let loseResponse = true;
const unreliable = new Stripe(key, {
  apiVersion: API_VERSION,
  telemetry: false,
  timeout: 15000,
  maxNetworkRetries: 0,
  httpClient: Stripe.createFetchHttpClient(async (url, init) => {
    const response = await fetch(url, init);
    if (
      loseResponse &&
      init?.method === 'POST' &&
      new URL(String(url)).pathname === '/v1/customers' &&
      response.ok
    ) {
      loseResponse = false;
      await response.arrayBuffer();
      // Stripe has responded successfully; the caller deliberately never receives that response.
      throw new TypeError('Injected response loss after remote customer creation');
    }
    return response;
  }),
});
const billing = new SafeStripe({
  stripe: unreliable,
  operations: storage.operations,
  scope: { platformAccountId: account, livemode: false },
  appOrigin: 'https://example.com',
  authorize: async ({ actor }) => actor.tenantId === runId && actor.actorId === 'sandbox-runner',
});
const actor = (operationId: string) => ({
  tenantId: runId,
  actorId: 'sandbox-runner',
  operationId,
});
const checks: string[] = [];
const cleanup: Array<() => Promise<unknown>> = [];
let stage = 'ambiguous customer write';
let failed = false;
try {
  await assert.rejects(billing.createCustomer(actor('customer'), { email }), {
    code: 'UPSTREAM_FAILED',
  });
  assert.equal(loseResponse, false, 'Response-loss checkpoint was not reached');
  const customer = await billing.createCustomer(actor('customer'), { email });
  const matching = await stripe.customers.list({ email, limit: 100 });
  assert.equal(matching.has_more, false);
  assert.deepEqual(
    matching.data.map((row) => row.id),
    [customer.id],
  );
  assert.equal((await billing.createCustomer(actor('customer'), { email })).id, customer.id);
  checks.push(
    'Remote customer mutation survived injected response loss with one customer and durable replay',
  );

  stage = 'sandbox catalog';
  const product = await stripe.products.create({ name: `SafeStripe E2E ${runId}` });
  cleanup.push(() => stripe.products.update(product.id, { active: false }));
  const price = await stripe.prices.create({
    product: product.id,
    currency: 'usd',
    unit_amount: 500,
  });
  cleanup.push(() => stripe.prices.update(price.id, { active: false }));
  const recurring = await stripe.prices.create({
    product: product.id,
    currency: 'usd',
    unit_amount: 500,
    recurring: { interval: 'month' },
  });
  cleanup.push(() => stripe.prices.update(recurring.id, { active: false }));
  stage = 'Checkout creation and replay';
  const request = {
    customerId: customer.id,
    mode: 'payment' as const,
    items: [{ priceId: price.id }],
    reference: runId,
  };
  const checkout = await billing.createCheckout(actor('checkout'), request);
  cleanup.push(() => stripe.checkout.sessions.expire(checkout.id));
  assert.equal((await billing.createCheckout(actor('checkout'), request)).id, checkout.id);
  assert.equal((await stripe.checkout.sessions.retrieve(checkout.id)).customer, customer.id);
  checks.push('Checkout creation, remote retrieval and replay');

  stage = 'refund and replay';
  const payment = await stripe.paymentIntents.create({
    amount: 500,
    currency: 'usd',
    customer: customer.id,
    payment_method: 'pm_card_visa',
    confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
  });
  assert.equal(payment.status, 'succeeded');
  cleanup.push(async () => {
    const refunds = await stripe.refunds.list({ payment_intent: payment.id, limit: 100 });
    if (!refunds.data.length) await stripe.refunds.create({ payment_intent: payment.id });
  });
  const refund = await billing.createRefund(actor('refund'), {
    paymentIntentId: payment.id,
    amount: 500,
  });
  assert.equal(
    (await billing.createRefund(actor('refund'), { paymentIntentId: payment.id, amount: 500 })).id,
    refund.id,
  );
  const refunds = await stripe.refunds.list({ payment_intent: payment.id });
  assert.equal(refunds.data.length, 1);
  assert.equal(refunds.data[0]?.amount, 500);
  checks.push('Paid sandbox PaymentIntent, single full refund and replay');

  stage = 'subscription and replay';
  const subscription = await billing.createSubscription(actor('subscription'), {
    customerId: customer.id,
    priceId: recurring.id,
    quantity: 1,
  });
  cleanup.push(() => stripe.subscriptions.cancel(subscription.id));
  assert.equal(
    (
      await billing.createSubscription(actor('subscription'), {
        customerId: customer.id,
        priceId: recurring.id,
        quantity: 1,
      })
    ).id,
    subscription.id,
  );
  assert.equal(
    (await stripe.subscriptions.retrieve(subscription.id)).items.data[0]?.price.id,
    recurring.id,
  );
  checks.push('Subscription creation, remote line-item verification and replay');
  stage = 'customer portal (default sandbox configuration required)';
  const portal = await billing.createPortalSession(actor('portal'), customer.id);
  assert.equal(portal.customer, customer.id);
  assert.equal(new URL(portal.url).protocol, 'https:');
  checks.push('Portal session for the expected test customer');
} catch {
  failed = true;
  console.error(
    `Stripe E2E failed during: ${stage}. Inspect this dedicated sandbox; credentials and remote payloads are omitted.`,
  );
} finally {
  for (const task of cleanup.reverse()) {
    try {
      await task();
    } catch {
      failed = true;
      console.error('Sandbox fixture cleanup needs manual review.');
    }
  }
  try {
    const customers = await stripe.customers.list({ email, limit: 100 });
    for (const customer of customers.data) await stripe.customers.del(customer.id);
  } catch {
    failed = true;
    console.error('Sandbox customer cleanup needs manual review.');
  }
  await storage.close();
  await mkdir('artifacts', { recursive: true });
  await writeFile(
    'artifacts/stripe-e2e.json',
    JSON.stringify(
      {
        at: new Date().toISOString(),
        sdk: Stripe.PACKAGE_VERSION,
        apiVersion: API_VERSION,
        node: process.version,
        passed: !failed,
        checks,
        notCovered: [
          'Browser payment fields and 3DS',
          'Actual signed webhook delivery over the public network',
          'Live payments',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  if (failed) process.exitCode = 1;
  else
    console.log(
      `Stripe sandbox service checks passed (${checks.length}); see the redacted report.`,
    );
}
