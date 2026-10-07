import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Stripe from 'stripe';
import { chromium, type Browser, type Page } from 'playwright';
import { API_VERSION } from '../src/primitives.js';
import { diagnostic } from '../src/telemetry.js';
import { sandboxCredentials } from './stripe-e2e-config.js';
import {
  checkoutUrl,
  DemoSession,
  DEMO_ORIGIN,
  WEBHOOK_ORIGIN,
  eventually,
} from './stripe-lifecycle-http.js';

type State = { id: string; status: string; amountPaid?: number; snapshotStatus?: string };
type Receipt = {
  orderId: string;
  sessionId: string;
  eventId: string;
  amount: number;
  currency: string;
  paidAt: string;
};
type OrderView = { order: { id: string; state: string }; receipt: Receipt | null };
type Workspace = { workspaceId: string; ready: boolean };
type Deployment = {
  backendSourceCommit: string;
  package: { version: string; source: string };
  worker: string;
};

const credentials = await sandboxCredentials(process.env);
assert.equal(credentials.temporary, false, 'Lifecycle tests require an account-verified sandbox');
const expectedDemo = process.env.STRIPE_LIFECYCLE_DEMO_COMMIT ?? '';
assert.match(expectedDemo, /^[a-f0-9]{40}$/, 'Set the reviewed deployed demo commit');
const stripe = new Stripe(credentials.key, {
  apiVersion: API_VERSION,
  telemetry: false,
  timeout: 15_000,
  maxNetworkRetries: 0,
});
const runId = randomUUID();
const metadata = { safestripe_lifecycle: runId };
const checks: string[] = [];
const customers: string[] = [],
  products: string[] = [],
  prices: string[] = [],
  endpoints: string[] = [],
  clocks: string[] = [];
const payments = new Set<string>();
const checkouts: string[] = [];
const subscriptions: string[] = [];
const sessions: DemoSession[] = [];
let browser: Browser | undefined;
let page: Page | undefined;
let stage = 'account verification',
  passed = false,
  accountIdentityVerified = false,
  cleanupPassed = true;
let deployment: Deployment | undefined;
let failure: { stage: string; code?: string; stripeType?: string; reason?: string } | undefined;
const failures: NonNullable<typeof failure>[] = [];
const checkpoint = (value: string) => {
  stage = value;
  console.log(`Lifecycle checkpoint: ${value}`);
};

const ref = (value: unknown): string => {
  if (typeof value === 'string') return value;
  assert.ok(value && typeof value === 'object' && 'id' in value && typeof value.id === 'string');
  return value.id;
};
const events = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'payment_intent.processing',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'refund.created',
  'refund.updated',
  'refund.failed',
  'invoice.paid',
  'invoice.payment_failed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
];

async function fixtureCustomer(testClock?: string) {
  const customer = await stripe.customers.create({
    name: 'SafeStripe lifecycle test',
    email: `lifecycle-${randomUUID()}@example.invalid`,
    address: {
      line1: '123 Test Street',
      city: 'San Francisco',
      postal_code: '94111',
      state: 'CA',
      country: 'US',
    },
    metadata,
    ...(testClock ? { test_clock: testClock } : {}),
  });
  customers.push(customer.id);
  return customer;
}

async function workspace(customerId: string, priceId: string, recurringPriceId: string) {
  const session = new DemoSession();
  const created = await session.request<Workspace>('/api/workspaces', 'POST', {
    consent: true,
    setupMode: 'existing',
    secretKey: credentials.key,
    accountId: credentials.account,
    customerId,
    priceId,
    recurringPriceId,
  });
  sessions.push(session);
  assert.match(created.workspaceId, /^[A-Za-z0-9_-]{16,64}$/);
  const endpoint = await stripe.webhookEndpoints.create({
    url: `${WEBHOOK_ORIGIN}/api/webhooks/stripe/${created.workspaceId}`,
    api_version: API_VERSION,
    enabled_events: events as Stripe.WebhookEndpointCreateParams.EnabledEvent[],
    description: 'Disposable SafeStripe lifecycle test',
    metadata,
  });
  endpoints.push(endpoint.id);
  assert.equal(endpoint.livemode, false);
  assert.ok(endpoint.secret);
  await session.request('/api/workspace/webhook', 'POST', { signingSecret: endpoint.secret });
  const info = await session.request<Deployment>('/api/status');
  assert.equal(
    info.backendSourceCommit,
    expectedDemo,
    'The backend must run the reviewed demo commit',
  );
  assert.equal(info.package.version, '0.3.0', 'This suite verifies the published 0.3.0 package');
  assert.equal(info.package.source, 'npm registry');
  assert.equal(info.worker, 'running');
  deployment = info;
  return { session, endpoint };
}

async function remoteEvent(type: string, resourceId: string) {
  return eventually(
    async () => {
      const found = await stripe.events.list({ type, limit: 100 });
      return found.data.find((event) => ref(event.data.object) === resourceId);
    },
    (event) => Boolean(event),
  );
}

async function recorded(session: DemoSession, event: Stripe.Event | undefined, status: string) {
  assert.ok(event);
  const result = await eventually(
    () => session.request<{ event: State | null }>(`/api/events/${event.id}`),
    (value) => value.event?.status === status,
  );
  assert.equal(result.event?.status, status);
  return result.event!;
}

async function state(session: DemoSession, id: string, status: string) {
  const result = await eventually(
    () => session.request<{ state: State | null }>(`/api/billing/${id}`),
    (value) => value.state?.status === status,
  );
  return result.state!;
}

async function resend(event: Stripe.Event | undefined, endpointId: string) {
  assert.ok(event);
  // The official CLI requests a new Stripe-signed delivery to this fixture endpoint.
  // Keep the key out of command arguments and discard payload-bearing CLI output.
  await promisify(execFile)(
    process.execPath,
    [
      resolve('node_modules/@stripe/cli/bin/shim.js'),
      'events',
      'resend',
      event.id,
      `--webhook-endpoint=${endpointId}`,
    ],
    {
      env: { ...process.env, STRIPE_API_KEY: credentials.key },
      timeout: 30_000,
      maxBuffer: 1_048_576,
    },
  );
}

async function input(page: Page, pattern: RegExp, value: string, required = true) {
  for (const frame of page.frames()) {
    const fields = await frame.locator('input').evaluateAll((elements) =>
      elements.map((element, index) => {
        const field = element as HTMLInputElement;
        return {
          index,
          text: [
            field.id,
            field.name,
            field.placeholder,
            field.getAttribute('aria-label'),
            ...(field.labels ? Array.from(field.labels, (label) => label.textContent) : []),
          ].join(' '),
        };
      }),
    );
    for (const field of fields)
      if (pattern.test(field.text)) {
        const element = frame.locator('input').nth(field.index);
        if (await element.isVisible()) {
          await element.fill(value);
          return true;
        }
      }
  }
  if (required) throw new Error('Required Stripe payment field is not available');
  return false;
}

async function card(page: Page, number: string) {
  checkpoint('selecting the hosted card payment option');
  // Checkout loads the selector asynchronously. An immediate visibility check
  // can miss it and leave every card field unopened for the entire timeout.
  if (!(await input(page, /card.?number/i, number, false))) {
    await eventually(
      async () => {
        for (const frame of page.frames()) {
          const option = frame.getByText('Card', { exact: true }).first();
          if (await option.isVisible()) {
            const control = option.locator(
              'xpath=ancestor-or-self::*[self::button or self::label or @role="radio" or @role="button" or @tabindex="0"][1]',
            );
            if (await control.count()) await control.click();
            else {
              // The hosted picker can place a presentation child over a full-row click target.
              let selected = false;
              for (const ancestor of await option.locator('xpath=ancestor::*').all()) {
                const box = await ancestor.boundingBox();
                if (box && box.width >= 200 && box.height >= 40 && box.height <= 100) {
                  await ancestor.click();
                  selected = true;
                  break;
                }
              }
              if (!selected) throw new Error('No visible Card row control');
            }
            return true;
          }
        }
        return false;
      },
      Boolean,
      60_000,
    );
    checkpoint('entering the hosted test card');
    await eventually(() => input(page, /card.?number/i, number, false), Boolean, 60_000);
  }
  const remember = page.locator('#enableStripePass');
  if (await remember.isVisible()) await remember.setChecked(false);
  await input(page, /expir|card.?expiry/i, '1235');
  await input(page, /cvc|cvv|security.?code/i, '123');
  await input(page, /billing.?name|cardholder|name.?on.?card/i, 'SafeStripe test', false);
  await input(page, /postal|zip/i, '94111', false);
  const buttons = page
    .getByRole('button')
    .filter({ hasText: /^(?:Pay|Subscribe)(?:Processing)?$/i });
  checkpoint('submitting the hosted test payment');
  await buttons.first().click();
}

async function order(session: DemoSession) {
  const id = `demo-${randomUUID()}`;
  await session.request(`/api/orders`, 'POST', { id });
  const checkout = await session.request<{ sessionId: string; url: string }>(
    `/api/orders/${id}/checkout`,
    'POST',
    {},
  );
  checkouts.push(checkout.sessionId);
  return { id, ...checkout };
}

async function receipt(session: DemoSession, id: string, sessionId: string) {
  const row = await eventually(
    () => session.request<OrderView>(`/api/orders/${id}`),
    (value) => value.order.state === 'paid' && Boolean(value.receipt),
  );
  assert.ok(row.receipt);
  assert.equal(row.receipt.orderId, id);
  assert.equal(row.receipt.sessionId, sessionId);
  assert.equal(row.receipt.amount, 500);
  assert.equal(row.receipt.currency, 'usd');
  assert.match(row.receipt.eventId, /^evt_[A-Za-z0-9]+$/);
  return row.receipt;
}

async function bankIntent(customerId: string, token: string) {
  // The public wrapper command creates an unconfirmed intent with dynamic methods.
  // Create a dedicated SDK fixture to test the published webhook layer's ACH states.
  const created = await stripe.paymentIntents.create(
    {
      customer: customerId,
      amount: 500,
      currency: 'usd',
      payment_method_types: ['us_bank_account'],
      metadata,
    },
    { idempotencyKey: `lifecycle:${runId}:bank:${randomUUID()}` },
  );
  const id = created.id;
  assert.match(id, /^pi_[A-Za-z0-9]+$/);
  payments.add(id);
  assert.deepEqual(created.payment_method_types, ['us_bank_account']);
  let payment = await stripe.paymentIntents.confirm(id, {
    payment_method: token,
    return_url: `${DEMO_ORIGIN}/success`,
    mandate_data: {
      customer_acceptance: {
        type: 'online',
        online: { ip_address: '127.0.0.1', user_agent: 'SafeStripe disposable sandbox test' },
      },
    },
  });
  if (payment.next_action?.type === 'verify_with_microdeposits')
    payment = await stripe.paymentIntents.verifyMicrodeposits(id, { amounts: [32, 45] });
  assert.equal(payment.status, 'processing');
  return payment;
}

async function advance(id: string, time: number) {
  await stripe.testHelpers.testClocks.advance(id, { frozen_time: time });
  await eventually(
    () => stripe.testHelpers.testClocks.retrieve(id),
    (clock) => clock.status === 'ready',
  );
}

async function recordFailure(error: unknown, captureBrowser = false) {
  const details = diagnostic(error);
  const reason =
    error instanceof Error
      ? error.message
          .split('\n')[0]!
          .replace(/https?:[^\s"'<>]+/g, '[URL]')
          .replace(/\b(?:sk|rk|pk|whsec)_[A-Za-z0-9_]+\b/g, '[credential]')
          .replace(
            /\b(?:acct|cus|pi|pm|cs|re|in|sub|price|prod|evt|we)_[A-Za-z0-9_]+\b/g,
            '[fixture ID]',
          )
          .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, '[email]')
          .replace(/\b\d{12,19}\b/g, '[test number]')
          .slice(0, 600)
      : undefined;
  const result = { stage, code: details.code, stripeType: details.stripeType, reason };
  failure ??= result;
  failures.push(result);
  console.error(
    `Lifecycle test failed during ${stage}; credentials and remote payloads are omitted.`,
  );
  if (captureBrowser && page && page.url().startsWith('https://checkout.stripe.com/')) {
    await mkdir('artifacts/lifecycle-browser', { recursive: true });
    // Screenshot may show synthetic contact/test-card entries, never the app's key form.
    // Structured field diagnostics omit values; neither artifact includes the address bar.
    await page.screenshot({ path: 'artifacts/lifecycle-browser/checkout.png' }).catch(() => {});
    const fields = [];
    const controls = [];
    for (const frame of page.frames()) {
      fields.push(
        await frame
          .locator('input')
          .evaluateAll((inputs) =>
            inputs.map((input) => ({
              id: input.id,
              name: (input as HTMLInputElement).name,
              label: input.getAttribute('aria-label'),
              type: (input as HTMLInputElement).type,
            })),
          )
          .catch(() => []),
      );
      controls.push(
        await frame
          .getByText('Card', { exact: true })
          .evaluateAll((elements) =>
            elements.map((element) => {
              const ancestors = [];
              for (
                let node: Element | null = element, depth = 0;
                node && depth < 5;
                node = node.parentElement, depth++
              )
                ancestors.push({
                  tag: node.tagName,
                  role: node.getAttribute('role'),
                  tabIndex: node.getAttribute('tabindex'),
                  pointerEvents: getComputedStyle(node).pointerEvents,
                });
              return ancestors;
            }),
          )
          .catch(() => []),
      );
    }
    const buttons = await page
      .getByRole('button')
      .evaluateAll((elements) =>
        elements.map((element) => ({
          text: element.textContent,
          ariaLabel: element.getAttribute('aria-label'),
          type: element.getAttribute('type'),
          disabled: (element as HTMLButtonElement).disabled,
        })),
      )
      .catch(() => []);
    await writeFile(
      'artifacts/lifecycle-browser/fields.json',
      JSON.stringify(
        {
          fields,
          buttons,
          controls,
          error:
            error instanceof Error
              ? {
                  name: error.name,
                  pointerIntercepted: error.message.includes('intercepts pointer events'),
                  interceptorTags: error.message
                    .split('\n')
                    .filter((line) => line.includes('intercepts pointer events'))
                    .map((line) => /<([A-Za-z0-9-]+)/.exec(line)?.[1])
                    .filter(Boolean),
                  notEnabled: error.message.includes('not enabled'),
                  detached: error.message.includes('detached'),
                  timeout: error.message.includes('Timeout'),
                }
              : undefined,
        },
        null,
        2,
      ) + '\n',
    );
  }
}

async function journey(work: () => Promise<void>, captureBrowser = false) {
  try {
    await work();
  } catch (error) {
    await recordFailure(error, captureBrowser);
  }
}

try {
  assert.equal((await stripe.accounts.retrieve(null)).id, credentials.account);
  accountIdentityVerified = true;
  checkpoint('fixture catalog');
  const purchase = await stripe.products.create({
    name: 'SafeStripe lifecycle purchase',
    metadata,
  });
  products.push(purchase.id);
  const price = await stripe.prices.create({
    product: purchase.id,
    currency: 'usd',
    unit_amount: 500,
    metadata,
  });
  prices.push(price.id);
  const plan = await stripe.products.create({
    name: 'SafeStripe lifecycle subscription',
    metadata,
  });
  products.push(plan.id);
  const recurring = await stripe.prices.create({
    product: plan.id,
    currency: 'usd',
    unit_amount: 1000,
    recurring: { interval: 'month' },
    metadata,
  });
  prices.push(recurring.id);
  const customer = await fixtureCustomer();
  const primary = await workspace(customer.id, price.id, recurring.id);
  await journey(async () => {
    browser = await chromium.launch({ headless: true });
    const checkoutPage = (page = await browser.newPage({ locale: 'en-US' }));
    checkpoint('hosted card payment and signed Firestore receipt');
    const first = await order(primary.session);
    await checkoutPage.goto(checkoutUrl(first.url));
    await card(checkoutPage, '4242424242424242');
    checkpoint('waiting for the signed Checkout receipt');
    const firstReceipt = await receipt(primary.session, first.id, first.sessionId);
    const paid = await stripe.checkout.sessions.retrieve(first.sessionId);
    assert.equal(paid.payment_status, 'paid');
    assert.equal(ref(paid.customer), customer.id);
    payments.add(ref(paid.payment_intent));
    checks.push(
      'Hosted browser payment produced an authenticated Firestore receipt for the expected order, Session and 500 USD cents',
    );

    checkpoint('actual signed duplicate deliveries');
    const paidEvent = await stripe.events.retrieve(firstReceipt.eventId);
    const before = await primary.session.request<{
      deliveries: { admitted: number; duplicates: number };
    }>(`/api/deliveries/${paidEvent.id}`);
    for (let n = 0; n < 10; n++) await resend(paidEvent, primary.endpoint.id);
    await eventually(
      () =>
        primary.session.request<{ deliveries: { admitted: number; duplicates: number } }>(
          `/api/deliveries/${paidEvent.id}`,
        ),
      (value) =>
        value.deliveries.admitted >= before.deliveries.admitted + 10 &&
        value.deliveries.duplicates >= before.deliveries.duplicates + 10,
    );
    const after = await primary.session.request<OrderView>(`/api/orders/${first.id}`);
    assert.deepEqual(after.receipt, firstReceipt);
    checks.push(
      'Ten additional authenticated duplicate admissions were recorded after Stripe CLI replays; the original receipt and paid time were unchanged',
    );

    checkpoint('declined card and retry of the same Checkout');
    const second = await order(primary.session);
    await checkoutPage.goto(checkoutUrl(second.url));
    await card(checkoutPage, '4000000000009995');
    await checkoutPage
      .getByText(/insufficient funds|card was declined/i)
      .first()
      .waitFor({ timeout: 30_000 });
    const declined = await primary.session.request<OrderView>(`/api/orders/${second.id}`);
    assert.notEqual(declined.order.state, 'paid');
    assert.equal(declined.receipt, null);
    await card(checkoutPage, '4242424242424242');
    checkpoint('waiting for the retried Checkout receipt');
    await receipt(primary.session, second.id, second.sessionId);
    const retried = await stripe.checkout.sessions.retrieve(second.sessionId);
    payments.add(ref(retried.payment_intent));
    checks.push(
      'A real card decline left the order unpaid; retrying the same Session produced its signed receipt',
    );

    checkpoint('partial refund and durable replay');
    const refundRun = {
      id: `run-${randomUUID()}`,
      workflow: 'refund',
      values: { paymentIntentId: ref(paid.payment_intent), amount: '250' },
    };
    const partial = await primary.session.request<{ result: { id: string } }>(
      '/api/runs',
      'POST',
      refundRun,
    );
    const replayed = await primary.session.request<{ result: { id: string } }>(
      '/api/runs',
      'POST',
      refundRun,
    );
    assert.equal(replayed.result.id, partial.result.id);
    const partialRemote = await stripe.refunds.retrieve(partial.result.id);
    assert.equal(partialRemote.amount, 250);
    assert.equal(partialRemote.status, 'succeeded');
    await recorded(
      primary.session,
      await remoteEvent('refund.created', partial.result.id),
      'succeeded',
    );
    assert.equal(
      ((await state(primary.session, partial.result.id, 'succeeded')) as State & { amount: number })
        .amount,
      250,
    );
    checks.push(
      'A real partial refund reached its signed Firestore state; replaying the same business operation returned the same refund',
    );

    checkpoint('remaining refund and retained sale receipt');
    const rest = await primary.session.request<{ result: { id: string } }>('/api/runs', 'POST', {
      ...refundRun,
      id: `run-${randomUUID()}`,
    });
    assert.notEqual(rest.result.id, partial.result.id);
    await recorded(
      primary.session,
      await remoteEvent('refund.created', rest.result.id),
      'succeeded',
    );
    const refunded = await stripe.charges.retrieve(
      ref((await stripe.paymentIntents.retrieve(ref(paid.payment_intent))).latest_charge),
    );
    assert.equal(refunded.amount_refunded, 500);
    assert.equal(refunded.refunded, true);
    const refunds = await stripe.refunds.list({
      payment_intent: ref(paid.payment_intent),
      limit: 10,
    });
    assert.equal(refunds.data.length, 2);
    assert.deepEqual(
      (await primary.session.request<OrderView>(`/api/orders/${first.id}`)).receipt,
      firstReceipt,
    );
    checks.push(
      'Two deliberate partial refunds closed the 500-cent charge; replay added no third refund and preserved the historical sale receipt',
    );
  }, true);

  await journey(async () => {
    checkpoint('ACH processing without premature payment');
    const pendingBank = await bankIntent(customer.id, 'pm_usBankAccount_processing');
    await recorded(
      primary.session,
      await remoteEvent('payment_intent.processing', pendingBank.id),
      'processing',
    );
    assert.equal((await state(primary.session, pendingBank.id, 'processing')).amountPaid, 0);
    await stripe.paymentIntents.cancel(pendingBank.id);
    await recorded(
      primary.session,
      await remoteEvent('payment_intent.canceled', pendingBank.id),
      'canceled',
    );
    checks.push(
      'An indefinitely processing ACH fixture had no received amount and its cancellation reached Firestore',
    );
  });
  await journey(async () => {
    checkpoint('ACH delayed success');
    const bank = await bankIntent(customer.id, 'pm_usBankAccount_success');
    await eventually(
      () => stripe.paymentIntents.retrieve(bank.id),
      (payment) => payment.status === 'succeeded',
    );
    await recorded(
      primary.session,
      await remoteEvent('payment_intent.succeeded', bank.id),
      'succeeded',
    );
    assert.equal((await state(primary.session, bank.id, 'succeeded')).amountPaid, 500);
    checks.push(
      'ACH remained unpaid while processing and reached a signed, durable paid state only after Stripe success',
    );
  });
  await journey(async () => {
    checkpoint('ACH delayed failure');
    const failedBank = await bankIntent(customer.id, 'pm_usBankAccount_insufficientFunds');
    await eventually(
      () => stripe.paymentIntents.retrieve(failedBank.id),
      (payment) => payment.status === 'requires_payment_method',
    );
    await recorded(
      primary.session,
      await remoteEvent('payment_intent.payment_failed', failedBank.id),
      'requires_payment_method',
    );
    assert.equal(
      (await state(primary.session, failedBank.id, 'requires_payment_method')).amountPaid,
      0,
    );
    checks.push('ACH delayed failure produced a signed failure record with no received amount');
  });

  await journey(async () => {
    checkpoint('subscription initial payment');
    const clock = await stripe.testHelpers.testClocks.create({
      frozen_time: Math.floor(Date.now() / 1000),
      name: 'SafeStripe lifecycle',
    });
    clocks.push(clock.id);
    const subscriber = await fixtureCustomer(clock.id);
    const visa = await stripe.paymentMethods.attach('pm_card_visa', { customer: subscriber.id });
    await stripe.customers.update(subscriber.id, {
      invoice_settings: { default_payment_method: visa.id },
    });
    const recurringWorkspace = await workspace(subscriber.id, price.id, recurring.id);
    const created = await recurringWorkspace.session.request<{ result: { id: string } }>(
      '/api/runs',
      'POST',
      {
        id: `run-${randomUUID()}`,
        workflow: 'subscription',
        values: {},
      },
    );
    const subscriptionId = created.result.id;
    subscriptions.push(subscriptionId);
    const pendingSubscription = await stripe.subscriptions.retrieve(subscriptionId);
    const pendingInvoice = await stripe.invoices.retrieve(ref(pendingSubscription.latest_invoice));
    if (pendingInvoice.status === 'open') {
      checkpoint('paying the initial subscription invoice');
      await stripe.invoices.pay(
        pendingInvoice.id,
        { payment_method: visa.id },
        { idempotencyKey: `lifecycle:${runId}:initial-invoice` },
      );
    }
    const subscription = await eventually(
      () => stripe.subscriptions.retrieve(subscriptionId),
      (sub) => sub.status === 'active',
    );
    const initialInvoice = ref(subscription.latest_invoice);
    await recorded(
      recurringWorkspace.session,
      await remoteEvent('invoice.paid', initialInvoice),
      'paid',
    );
    assert.equal(
      (await state(recurringWorkspace.session, initialInvoice, 'paid')).amountPaid,
      1000,
    );
    checks.push(
      'Initial subscription invoice payment reached the authenticated Firestore billing record',
    );

    checkpoint('failed renewal and recovery');
    // Hold only this fixture destination so genuine events can be delivered out of order later.
    await stripe.webhookEndpoints.update(recurringWorkspace.endpoint.id, { disabled: true });
    const failureMethod = await stripe.paymentMethods.attach('pm_card_chargeCustomerFail', {
      customer: subscriber.id,
    });
    await stripe.subscriptions.update(subscriptionId, { default_payment_method: failureMethod.id });
    const periodEnd = subscription.items.data[0]?.current_period_end;
    assert.ok(periodEnd);
    await advance(clock.id, periodEnd + 7200);
    const renewed = await eventually(
      () => stripe.subscriptions.retrieve(subscriptionId),
      (sub) => sub.status === 'past_due',
    );
    const renewalInvoiceId = ref(renewed.latest_invoice);
    assert.notEqual(renewalInvoiceId, initialInvoice);
    const failedInvoice = await stripe.invoices.retrieve(renewalInvoiceId);
    assert.equal(failedInvoice.status, 'open');
    assert.ok(failedInvoice.amount_remaining > 0);
    const failedEvent = await remoteEvent('invoice.payment_failed', renewalInvoiceId);
    await stripe.subscriptions.update(subscriptionId, { default_payment_method: visa.id });
    const recovered = await stripe.invoices.pay(
      renewalInvoiceId,
      { payment_method: visa.id },
      { idempotencyKey: `lifecycle:${runId}:recover` },
    );
    assert.equal(recovered.status, 'paid');
    const recoveredEvent = await remoteEvent('invoice.paid', renewalInvoiceId);
    await stripe.webhookEndpoints.update(recurringWorkspace.endpoint.id, { disabled: false });
    await resend(recoveredEvent, recurringWorkspace.endpoint.id);
    await recorded(recurringWorkspace.session, recoveredEvent, 'paid');
    assert.equal(
      (await state(recurringWorkspace.session, renewalInvoiceId, 'paid')).amountPaid,
      1000,
    );
    checks.push(
      'A test-clock renewal actually failed, then a corrected payment method recovered the invoice and its durable paid record',
    );

    checkpoint('distinct older failure delivered after recovery');
    await resend(failedEvent, recurringWorkspace.endpoint.id);
    const late = await recorded(recurringWorkspace.session, failedEvent, 'paid');
    assert.equal(late.snapshotStatus, 'open');
    assert.equal(
      (await state(recurringWorkspace.session, renewalInvoiceId, 'paid')).amountPaid,
      1000,
    );
    checks.push(
      'The genuine earlier failed-invoice event arrived after invoice.paid and could not restore its stale open state',
    );

    checkpoint('subscription cancellation');
    await stripe.subscriptions.cancel(subscriptionId);
    await recorded(
      recurringWorkspace.session,
      await remoteEvent('customer.subscription.deleted', subscriptionId),
      'canceled',
    );
    await state(recurringWorkspace.session, subscriptionId, 'canceled');
    checks.push('Subscription cancellation reached the signed, durable canceled state');
  });
  passed = failures.length === 0 && checks.length === 12;
} catch (error) {
  await recordFailure(error);
} finally {
  await browser?.close().catch(() => {
    cleanupPassed = false;
  });
  const cleanup = async (work: () => Promise<unknown>) => {
    try {
      await work();
    } catch {
      cleanupPassed = false;
    }
  };
  for (const id of endpoints) await cleanup(() => stripe.webhookEndpoints.del(id));
  for (const session of sessions) await cleanup(() => session.request('/api/workspace', 'DELETE'));
  for (const id of subscriptions)
    await cleanup(async () => {
      if ((await stripe.subscriptions.retrieve(id)).status !== 'canceled')
        await stripe.subscriptions.cancel(id);
    });
  for (const id of checkouts)
    await cleanup(async () => {
      const checkout = await stripe.checkout.sessions.retrieve(id);
      if (checkout.payment_intent) payments.add(ref(checkout.payment_intent));
      if (checkout.status === 'open') await stripe.checkout.sessions.expire(id);
    });
  for (const id of payments)
    await cleanup(async () => {
      const payment = await stripe.paymentIntents.retrieve(id);
      if (payment.status === 'succeeded') {
        const charge = await stripe.charges.retrieve(ref(payment.latest_charge));
        const remaining = payment.amount_received - charge.amount_refunded;
        if (remaining > 0)
          await stripe.refunds.create(
            { payment_intent: id, amount: remaining },
            { idempotencyKey: `lifecycle:${runId}:refund:${id}` },
          );
      } else if (payment.status !== 'canceled') await stripe.paymentIntents.cancel(id);
    });
  for (const id of customers)
    await cleanup(async () => {
      const customer = await stripe.customers.retrieve(id);
      if (!customer.deleted) await stripe.customers.del(id);
    });
  for (const id of clocks) await cleanup(() => stripe.testHelpers.testClocks.del(id));
  for (const id of prices) await cleanup(() => stripe.prices.update(id, { active: false }));
  for (const id of products) await cleanup(() => stripe.products.update(id, { active: false }));
  await mkdir('artifacts', { recursive: true });
  const manifest = JSON.parse(await readFile('package.json', 'utf8'));
  const report = {
    at: new Date().toISOString(),
    passed: passed && cleanupPassed,
    cleanupPassed,
    runnerSourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceDirty: Boolean(
      execFileSync(
        'git',
        [
          'status',
          '--porcelain',
          '--',
          'src',
          'scripts/stripe-lifecycle.ts',
          'scripts/stripe-lifecycle-http.ts',
          'package-lock.json',
        ],
        { encoding: 'utf8' },
      ).trim(),
    ),
    accountIdentityVerified,
    credentialMode: credentials.keyKind,
    sdk: Stripe.PACKAGE_VERSION,
    apiVersion: API_VERSION,
    node: process.version,
    browserTool: manifest.devDependencies.playwright,
    stripeCli: manifest.devDependencies['@stripe/cli'],
    deployment: deployment
      ? {
          backendSourceCommit: deployment.backendSourceCommit,
          packageVersion: deployment.package.version,
          packageSource: deployment.package.source,
          frontendOrigin: DEMO_ORIGIN,
          webhookOrigin: WEBHOOK_ORIGIN,
          storage: 'Cloud Firestore',
        }
      : undefined,
    failure,
    failures,
    checks,
    notCovered: [
      'Live payments',
      'Every payment method and account eligibility combination',
      'Company-specific authorization and entitlement policies',
    ],
  };
  await writeFile('artifacts/stripe-lifecycle.json', JSON.stringify(report, null, 2) + '\n');
  // Fixture IDs aid owner cleanup after interruption. No keys, cookies or secret URLs are retained.
  await writeFile(
    'artifacts/stripe-lifecycle-fixtures.json',
    JSON.stringify(
      {
        runId,
        customers,
        products,
        prices,
        endpoints,
        clocks,
        payments: [...payments],
        checkouts,
        subscriptions,
      },
      null,
      2,
    ) + '\n',
  );
  if (!report.passed) process.exitCode = 1;
  else
    console.log(
      `Real payment lifecycle checks passed (${checks.length}); see the redacted report.`,
    );
}
