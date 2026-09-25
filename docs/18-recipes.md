# Common billing recipes

These examples run on the server after authentication and authorization. They assume `billing` is the result of `createSafeStripe`, `actor` identifies the signed-in tenant and operator, and IDs/amounts come from your trusted records. The [framework guide](16-frameworks.md) shows where to call them.

Use one stable operation ID for each intended write. A workflow with several writes needs several IDs. Store those IDs before executing the workflow so a restart can resume the same steps.

## Create a customer once

```ts
const customer = await billing.createCustomer(
  { ...actor, operationId: `customer:${user.id}` },
  { email: user.email, name: user.name },
);
```

Save the returned customer ID in your tenant/customer mapping. Retrying the same identity returns the recorded resource. Changing the email under the same create identity is a conflict; a customer-profile update is a separate operation. Customer creation itself has no existing customer resource to check, so the authorizer must still enforce who may create a customer and which tenant receives it.

## Send a customer to the billing portal

```ts
const portal = await billing.createPortalSession(actor, customerId);
// Return this URL only to the authenticated owner, with Cache-Control: no-store.
```

Configure the portal features in Stripe first. The method authorizes access each time and creates a fresh short-lived Session with a fixed `/billing` return path. Do not store the portal URL as a permanent account link or cache it publicly.

## Create a partial refund

```ts
const refund = await billing.createRefund(
  { ...actor, operationId: `refund:${refundRequest.id}` },
  {
    paymentIntentId: refundRequest.paymentIntentId,
    amount: refundRequest.amountMinor,
    reason: 'requested_by_customer',
  },
);
```

`amount` is an integer in the currency's minor unit. Do not use floating-point arithmetic to calculate it. Your refund policy must check ownership, permission, currency, remaining refundable amount, previous refunds and approval limits. A successful create response is not the entire refund lifecycle; reconcile its status and relevant events. Do not generate a new refund ID because a response timed out.

## Build an invoice in separate durable steps

```ts
const draft = await billing.createInvoice(
  { ...actor, operationId: `invoice:${invoiceRequest.id}:create` },
  { customerId, daysUntilDue: 14 },
);

await billing.addInvoiceItem(
  { ...actor, operationId: `invoice:${invoiceRequest.id}:line-1` },
  {
    customerId,
    invoiceId: draft.id,
    priceId,
    quantity: 1,
  },
);

const finalized = await billing.finalizeInvoice(
  { ...actor, operationId: `invoice:${invoiceRequest.id}:finalize` },
  { invoiceId: draft.id },
);
```

The draft excludes unrelated pending invoice items and has automatic advancement disabled. Review line items, customer, tax treatment and collection policy before finalizing. Finalization in this wrapper keeps `auto_advance: false`; it does not automatically email the invoice or collect funds. Sending/collection needs a separately authorized workflow. Finalized invoice corrections may require credit notes or other accounting steps rather than editing the original amount.

## Start a subscription through Checkout

```ts
const session = await billing.createCheckout(
  { ...actor, operationId: `subscription-checkout:${signup.id}` },
  {
    customerId,
    mode: 'subscription',
    items: [{ priceId: recurringPriceId, quantity: 1 }],
    reference: signup.id,
  },
);
```

Use a recurring Price. Store the Session/customer/subscription mapping and process subscription and invoice events. Access is a business entitlement: define how active, trialing, past-due, paused, unpaid and cancelled subscriptions affect the service. The first Checkout completion is not an enduring entitlement policy.

`createSubscription` also exists for advanced server-led workflows. It uses `default_incomplete`; it does not automatically complete authentication or guarantee that the first invoice was paid. Ordinary customer sign-up should usually start with Checkout.

## Preview a plan change, then apply the same terms

```ts
const change = {
  subscriptionId,
  itemId,
  priceId: newPriceId,
  quantity: 10,
  prorationDate: quote.prorationDate,
};

const preview = await billing.previewSubscriptionChange(actor, change);
```

Store the exact quote inputs and show the invoice preview to the customer. On a separate confirmation request, re-authorize ownership and confirm the quote is still applicable before applying those inputs:

```ts
const updated = await billing.updateSubscription(
  { ...actor, operationId: `plan-change:${quote.id}` },
  quote.change,
);
```

The update verifies that the item belongs to the subscription, uses the quoted timestamp and requests an invoice with `pending_if_incomplete`. A pending update is not proof that the customer has paid for the new entitlement. Handle its completion or expiry. Define your quote lifetime and concurrent subscription-edit policy in the application.

## Cancel at the end of the period

```ts
const subscription = await billing.cancelSubscriptionAtPeriodEnd(
  { ...actor, operationId: `cancellation:${cancellation.id}` },
  { subscriptionId },
);
```

This schedules cancellation; it does not immediately revoke access, issue a refund or erase the customer. Show the resulting state and let your entitlement rules determine the access end date.

## Deliver a saved outbox message

A transaction records a message; an outbox worker performs the external action after that transaction commits.

```ts
import { dispatchOutboxOnce, runWorkerLoop } from '@israeloduguwa/safestripe';

await runWorkerLoop(
  () => dispatchOutboxOnce(
    billing.storage.jobs,
    billing.scopeId,
    async (message) => {
      await notifications.deliver({
        type: message.type,
        payload: message.payload,
        idempotencyKey: message.idempotencyKey,
      });
    },
  ),
  { signal: shutdown.signal, concurrency: 2 },
);
```

`notifications` is your own destination client. Its delivery operation must deduplicate the supplied key. Delivery is **at least once**: a process can die after the destination accepts a message but before the local job is marked complete. SafeStripe cannot make an arbitrary remote email or fulfillment API transactional.

## Recover a failed task

Inspect a job by its queue, scope and event/message ID. Authenticate the operator and authorize the affected account before calling administrative methods:

```ts
const job = await billing.storage.jobs.inspect('webhook', billing.scopeId, eventId);

if (job?.state === 'dead') {
  await billing.storage.jobs.replayDead(
    'webhook',
    billing.scopeId,
    eventId,
    operator.id,
    'Corrected the order mapping and verified the Stripe Session.',
  );
}
```

Correct the underlying cause before replaying. `resolveForReview` handles an ambiguous operation only after you have verified the matching remote Stripe resource. Neither recovery method performs business investigation for you. Keep them out of public customer endpoints.
