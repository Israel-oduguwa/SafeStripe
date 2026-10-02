# Choose a billing model

Start with how you want to charge, then choose the Stripe price and the SafeStripe operation. A price is your commercial agreement: currency, amount, interval and pricing model. Keep it on your server. The browser should select an approved plan, not invent the amount or submit an arbitrary price ID.

This guide covers the new 0.3.0 workflow methods. The older scoped 0.2.0 npm package does not contain them. Until the unscoped release is published, use the release archive supplied with the test workspace.

## What can I build?

| Model | Start with | SafeStripe operation | What your application still owns |
| --- | --- | --- | --- |
| One-time purchase | One-time Price + Checkout | `createCheckout` | Order, fulfillment and refund policy |
| Fixed SaaS plan | Recurring Price | `createCheckout` or `createSubscription` | Customer mapping, access and renewal handling |
| Per-seat SaaS | Licensed recurring Price | `createMultiItemSubscription` | Seat counts, approval and access |
| Graduated or volume tiers | Tiered recurring Price | `createTieredPrice`, then subscription creation | Approved tier boundaries and price changes |
| Existing basic metered billing | Meter + metered Price | `createMultiItemSubscription`, `recordUsage` | Usage ledger, trusted measurements and reconciliation |
| New usage-based product | Evaluate Stripe Metronome | Separate Metronome integration | Contracts, metrics and ingestion architecture |
| Phased enterprise agreement | Prices + Subscription Schedule | `createSchedule` | Signed terms and contract approvals |
| Sales-assisted quote | Customer + approved Prices | `createQuote`, `finalizeQuote`, `acceptQuote` | Evidence of acceptance |
| Standalone invoice | Customer + Invoice + Invoice Items | `createInvoice`, `addInvoiceItem`, `finalizeInvoice` | Sending, collection and accounts-receivable policy |
| Marketplace | Accounts v2 recipient + platform payment | `createMarketplaceAccount`, `createTransfer` | Seller identity, allocations, liability and dispute recovery |

The methods are deliberately specific. They do not expose every optional parameter in Stripe. If a workflow needs an unsupported option, use the official SDK behind your own authorization and durable-operation design; an arbitrary SDK call does not acquire SafeStripe's protections automatically.

## The three inputs every write needs

Initialize `billing` once with your chosen store and authorizer. Follow [Getting started](11-getting-started.md) for Firestore, MongoDB, PostgreSQL or local SQLite. Then provide:

1. An authenticated actor: tenant and operator from your session.
2. A stable business operation ID, saved before making the request.
3. Approved parameters loaded from your application's records.

```ts
const actor = {
  tenantId: membership.tenantId,
  actorId: user.id,
  operationId: savedBillingRequest.id,
};
```

Keep the ID when retrying the same action. Create a new ID when the business action changes. An operation ID is not authentication; every retry still passes through your authorizer.

## Fixed and per-seat subscriptions

Checkout collects the payment method and handles the initial payment interface. Use it for ordinary customer signup. Direct subscription creation is useful when your application already manages the billing relationship.

```ts
const session = await billing.createCheckout(actor, {
  customerId: customer.id,
  mode: 'subscription',
  items: [{ priceId: approvedPlan.priceId, quantity: team.seats }],
  reference: signup.id,
});
```

A multi-item subscription can combine licensed items or combine a fixed fee with an existing basic metered price:

```ts
const subscription = await billing.createMultiItemSubscription(actor, {
  customerId: customer.id,
  items: [
    { priceId: monthlyPlatformPriceId, quantity: 1 },
    { priceId: seatPriceId, quantity: 12 },
  ],
});
```

The initial status may be `incomplete`. Do not grant paid access from the create response alone. Handle signed subscription and invoice events, retrieve the current state and apply your access policy. [Stripe's subscription integration guide](https://docs.stripe.com/billing/subscriptions/build-subscriptions) describes the lifecycle.

## Graduated and volume tiers

Graduated pricing charges each band separately. Volume pricing chooses the band's rate based on total quantity, then applies it to every unit. Those models can produce very different totals at a boundary.

```ts
const price = await billing.createTieredPrice(actor, {
  productId,
  currency: 'usd',
  interval: 'month',
  mode: 'graduated',
  tiers: [
    { upTo: 10, unitAmount: 1000 },
    { upTo: 'inf', unitAmount: 800 },
  ],
});
```

At twelve seats, this example is $116 monthly: ten at $10 and two at $8. With `mode: 'volume'`, all twelve would cost $8 each, totaling $96. These amounts exclude tax and discounts.

This helper creates licensed recurring prices with integer minor-unit amounts. It requires increasing tier boundaries and a final infinite band. It does not combine `transform_quantity` with tiered prices, create fractional-cent rates or update an existing price's amounts. Create a new price for a new commercial agreement. Test 1, 10, 11 and 12 seats before publishing this example's plans.

## Usage-based billing

For a new usage-based integration, first evaluate [Stripe Metronome](https://docs.stripe.com/billing/usage-based). SafeStripe does not include its client or implement its contracts and rate cards. The methods below target existing **basic Billing Meters** integrations with raw sum meters.

Create the meter during administrative setup, then create a metered recurring Price in Stripe that references it. Creating a meter alone does not create a billable subscription.

```ts
const meter = await billing.createMeter(actor, {
  eventName: 'api_requests',
  displayName: 'API requests',
});
```

Subscribe the customer without supplying a quantity for the metered item:

```ts
const subscription = await billing.createMultiItemSubscription(actor, {
  customerId,
  items: [{ priceId: meteredPriceId }],
});
```

Persist an event in your usage ledger before submitting it. Its timestamp and value must be stable across retries.

```ts
const acknowledgement = await billing.recordUsage(
  { ...actor, operationId: usageEvent.id },
  {
    customerId: usageEvent.customerId,
    meterId: approvedMeterId,
    value: usageEvent.units,
    timestamp: usageEvent.occurredAt,
  },
);
```

`status: 'accepted'` is an ingestion acknowledgement. It does not mean the value has been aggregated, included on an invoice or paid. SafeStripe derives the meter-event identifier from the same scoped business operation used for durable retries. A successful replay returns the saved-input acknowledgement without sending another event; the meter-events API does not provide ordinary resource retrieval for this receipt.

Stripe's basic API accepts timestamps within its documented ingestion window and processes aggregates asynchronously. The helper rejects inactive meters, non-sum aggregation and pre-aggregated windows. Inspect [meter-event requirements](https://docs.stripe.com/api/billing/meter-event/create) before choosing this path. Batch or stream ingestion, negative corrections, credit burndown and high-volume ingestion are separate designs. Do not run one synchronous HTTP billing call in every request on a busy product; record usage first and drain a bounded queue.

## Trials and promotions

```ts
const subscription = await billing.createMultiItemSubscription(actor, {
  customerId,
  items: [{ priceId, quantity: 1 }],
  trialDays: 7,
  promotionCodeId: approvedPromotionCodeId,
});
```

The helper uses a pause policy when the trial ends without a payment method. The promotion code must exist and be eligible; Stripe checks its restrictions. Your policy must approve the promotion's use by this customer. This release does not create coupons, promotion codes or credit grants.

For customer-entered promotions in Checkout, set `allowPromotionCodes: true`. For a Checkout trial, set `trialDays`. Both are optional. Trial terms and cancellation information belong in your customer-facing signup flow.

## Pause, resume and retain

These operations mean different things:

| Intent | Method | Effect |
| --- | --- | --- |
| Stop collecting new invoices temporarily | `setSubscriptionCollection({ subscriptionId, behavior: 'keep_as_draft' })` | Subscription can remain active; invoices stay draft |
| Collect future invoices again | `setSubscriptionCollection({ subscriptionId, behavior: 'collect' })` | Clears the collection pause; old drafts still need review |
| Undo a scheduled period-end cancellation | `restoreSubscription({ subscriptionId })` | Sets `cancel_at_period_end: false`; cannot resurrect an ended subscription |
| Resume a subscription with status `paused` | `resumePausedSubscription({ subscriptionId })` | Starts resumption with a new billing-cycle anchor; payment may still be required |

Pass `actor` as the first argument to every method. Collection changes do not decide application access. Review Stripe's [pause-collection behavior](https://docs.stripe.com/billing/subscriptions/pause-payment) and test it separately from a truly paused subscription.

Use the existing preview/apply pair for mid-cycle plan changes. Persist the preview's proration timestamp and approved terms; do not quietly recalculate them on apply.

## Quotes and phased contracts

A quote has separate drafting, finalization and acceptance steps. Use one durable ID per step. Never infer customer acceptance from a page visit.

```ts
const quote = await billing.createQuote(draftActor, {
  customerId,
  items: [{ priceId, quantity: 10 }],
  daysUntilDue: 30,
});
await billing.finalizeQuote(finalizeActor, { quoteId: quote.id });
// Record actual customer acceptance before running this step.
await billing.acceptQuote(acceptActor, { quoteId: quote.id });
```

Quote access depends on the Stripe account and product configuration. Acceptance can produce an invoice or subscription; inspect the returned record and its subsequent events. It is not evidence of payment.

For a three-month introductory period followed by nine months on a standard plan:

```ts
const schedule = await billing.createSchedule(actor, {
  customerId,
  startAt: approvedContract.startAt,
  daysUntilDue: 30,
  endBehavior: 'release',
  phases: [
    { months: 3, items: [{ priceId: introductoryPriceId, quantity: 1 }] },
    { months: 9, items: [{ priceId: standardPriceId, quantity: 1 }] },
  ],
});
```

This helper uses net-term invoices and disables phase-change prorations. It does not send an invoice email from the create call. `release` leaves the subscription running at the final terms after the schedule ends; choose `cancel` if the agreement should end. Check [schedule phase behavior](https://docs.stripe.com/billing/subscriptions/subscription-schedules) before automating contract changes.

## Credits and receivables

`createCreditNote` reduces an **open invoice's unpaid balance**. The narrow helper rejects paid invoices and amounts exceeding the remaining balance. A refund for money already collected is a different operation.

```ts
await billing.createCreditNote(actor, {
  invoiceId,
  amount: 1000,
  memo: 'Agreed service adjustment',
});
```

`adjustCustomerBalance` creates an invoice-balance transaction. A negative amount credits a future invoice; a positive amount adds a debit. Neither direction transfers cash.

```ts
await billing.adjustCustomerBalance(actor, {
  customerId,
  amount: -1000,
  currency: 'usd',
  description: 'Service credit',
});
```

Stripe supports more elaborate [credit-note allocations](https://docs.stripe.com/api/credit_notes/create), including paid-invoice refunds and out-of-band adjustments. Those allocations need their own reviewed workflow. Accounts-receivable aging, offline-payment evidence and collection emails are not calculated by these helpers.

## Test a subscription without waiting a month

1. Create a test clock with `createTestClock` and a saved starting timestamp.
2. Create a new customer on it using `createClockCustomer`. An existing customer cannot be attached afterward.
3. Create a seven-day trial for that new customer.
4. Call `advanceTestClock` with a saved target timestamp eight days later.
5. Wait for Stripe to finish advancing. Inspect the paused subscription and relevant events.
6. Add a test payment method, resume and exercise a renewal separately.

Clock operations reject live mode. Time advancement is asynchronous and Stripe limits how far you can move a clock based on attached resources. The demo caps a jump at 28 days; that cap is not a guarantee that every attached configuration accepts the jump. See [Stripe test clocks](https://docs.stripe.com/billing/testing/test-clocks).

## Tax belongs in the plan

Before setting `automaticTax: true` on Checkout, configure Stripe Tax and confirm active registrations. SafeStripe checks that settings are active and at least one active registration exists, but that cannot establish coverage for a particular customer. Verify the product tax code, address and a sandbox calculation in each applicable jurisdiction. The [tax and account-services guide](22-account-services.md) explains the distinction.
