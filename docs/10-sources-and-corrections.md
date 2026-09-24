# Sources and compatibility

## Research baseline

Reviewed on 24 September 2026. This release pins `stripe@22.6.2` and API `2026-08-26.dahlia`. Review SDK types, endpoint versions, and handler assumptions together when upgrading. Stripe Dashboard navigation and product availability can vary by account and region.

| Topic | Primary reference |
| --- | --- |
| Official SDK and request configuration | [stripe-node](https://github.com/stripe/stripe-node) |
| Idempotency semantics | [Idempotent requests](https://docs.stripe.com/api/idempotent_requests) |
| Ambiguous errors and retries | [Advanced error handling](https://docs.stripe.com/error-low-level) |
| Webhook delivery, signatures and testing | [Webhooks](https://docs.stripe.com/webhooks) |
| Checkout fulfillment | [Fulfill orders](https://docs.stripe.com/checkout/fulfillment) |
| Payment state | [Verify payment status](https://docs.stripe.com/payments/payment-intents/verifying-status) |
| Subscription lifecycle | [How subscriptions work](https://docs.stripe.com/billing/subscriptions/overview) |
| Billing events | [Subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks) |
| Current preview API | [Create an invoice preview](https://docs.stripe.com/api/invoices/create_preview) |
| Proration behavior | [Prorations](https://docs.stripe.com/billing/subscriptions/prorations) |
| Invoice operation | [Dashboard invoicing](https://docs.stripe.com/invoicing/dashboard) |
| Invoice status transitions | [Invoice workflow transitions](https://docs.stripe.com/invoicing/integration/workflow-transitions) |
| Cancellation | [Cancel subscriptions](https://docs.stripe.com/billing/subscriptions/cancel) |
| Refund lifecycle | [Refunds](https://docs.stripe.com/refunds) |
| Dispute review and evidence | [Respond to disputes](https://docs.stripe.com/disputes/responding) |
| Currency semantics | [Supported currencies](https://docs.stripe.com/currencies) |
| Balance movement | [Balance report](https://docs.stripe.com/reports/balance) |
| Payout matching | [Payout reconciliation](https://docs.stripe.com/reports/payout-reconciliation) |
| API capacity | [Rate limits](https://docs.stripe.com/rate-limits) |
| Key management | [Secret key best practices](https://docs.stripe.com/keys-best-practices) |
| Client integration security | [Integration security guide](https://docs.stripe.com/security/guide) |
| Isolated testing | [Sandboxes](https://docs.stripe.com/sandboxes) |
| Payment scenarios | [Testing](https://docs.stripe.com/testing) |
| Recurring-time simulation | [Test clocks and simulations](https://docs.stripe.com/billing/testing/test-clocks) |
| Connect SaaS setup | [SaaS account creation](https://docs.stripe.com/connect/saas/tasks/create) |
| Connect marketplace setup | [Marketplace account creation](https://docs.stripe.com/connect/marketplace/tasks/create) |
| Transfer architecture | [Separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers) |
| Tax prerequisites | [Stripe Tax setup](https://docs.stripe.com/tax/set-up) |
| Tax validation | [Testing Stripe Tax](https://docs.stripe.com/tax/testing) |
| Current usage-billing product | [Usage-based billing](https://docs.stripe.com/billing/usage-based) |
| Next.js bundling customization | [Next.js webpack configuration](https://nextjs.org/docs/app/api-reference/config/next-config-js/webpack) |

Some Stripe pages route to variants based on integration type. Select the hosted Checkout or relevant Connect variant before applying a code example. The repository's compiled SDK types provide an additional check of the exact parameters used here.

## Common integration mistakes

| Assumption | Integration rule |
| --- | --- |
| Event-ID uniqueness prevents double fulfillment | It prevents duplicate delivery of one event. Different events and repair jobs can still request the same business effect; protect the effect too. |
| Only a single queue worker may mutate the ledger | A single mutation policy is useful; one global worker is unnecessary. Concurrent workers can safely operate with transactions, scope partitioning and business uniqueness. |
| Webhooks guarantee eventual delivery | Delivery can duplicate/reorder and retries are finite. Reconciliation is necessary for durable correctness. |
| An old update just needs a missing-record upsert | Upsert solves absence, not stale overwrite. Serialize current-state refresh or use a justified resource-version protocol. |
| Use `invoices.retrieveUpcoming()` | This implementation uses the current `invoices.createPreview()` API with an explicit shared proration timestamp. |
| The preview is the final invoice amount | It is a quote under inputs at a time. Concurrent edits and other billing factors can change the final bill. |
| Hash user/cart/total to generate the idempotency key | Bind a stable unique business operation ID to a separate immutable payload fingerprint. Identical carts can be separate valid purchases. |
| A retry after any amount of time remains safe | Stripe keys may be pruned after their retention window. Keep durable records and stop ambiguous automatic retries before that boundary. |
| On failed authentication, set subscription to past due/unpaid | Stripe controls its lifecycle. Your application controls recovery messaging and access/grace policy. |
| Every negative connected balance debits the platform bank | Liability and recovery depend on account responsibilities, charge model and configuration. Model the actual arrangement. |
| `balance.available` lets you impose payout holds universally | It is a state signal. Payout control requires the appropriate permissions, contract and supported configuration. |
| An enterprise wrapper can solve all security/performance issues | It can enforce specific invariants. Host authorization, financial policy, deployment and measured capacity remain essential. |

## Maintaining the handbook

For each release, update the SDK/API baseline, rerun all tests, build both integrations, check changed webhook schemas, and review affected Dashboard procedures. Keep a short changelog explaining what changed and why. Revalidate task rubrics when Stripe UI or product behavior changes; an outdated click sequence should not make a competent operator fail an outcome-based assessment.

Record verification dates separately from publication dates. Link the exact primary page supporting a behavior, and label original design recommendations as design recommendations. Keep measured results separate from proposed capacity targets.
