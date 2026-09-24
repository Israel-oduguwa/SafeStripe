# Stripe objects and state

## Model the business before choosing endpoints

An order is your promise to deliver something. A Checkout Session is a payment experience. A PaymentIntent manages a payment attempt lifecycle. An invoice records an amount owed. A subscription schedules recurring commercial obligations. None of these alone is your entire business transaction.

Choose a clear ownership graph:

```text
Organization / tenant
  └─ application customer mapping → Stripe Customer
       ├─ order → Checkout Session → payment resources
       └─ contract → Subscription → Invoices → invoice payment resources

Successful payment → business fulfillment record → external delivery intent
Financial movements → Balance Transactions → payout / bank reconciliation
```

Store account and environment alongside every Stripe ID. Treat `(Stripe account, sandbox/live, object ID)` as the resource identity. A `cus_...` string supplied by a browser is an identifier, not proof of ownership.

## Resource field guide

| Resource | What it represents | Operational question | Frequent mistake |
| --- | --- | --- | --- |
| Customer | A billing relationship and reusable billing information | Is this the correct legal/customer record in the correct account? | Assuming email uniquely identifies a tenant |
| Product / Price | What is sold and its commercial terms | Is this the approved recurring or one-time price and currency? | Letting the client choose arbitrary prices or quantities |
| Checkout Session | Customer-facing checkout state | Did this session complete and is payment settled enough for this product? | Treating arrival at a success URL as proof of payment |
| PaymentIntent | Lifecycle of a payment | Does it require a method, authentication, capture, or more processing time? | Creating a new intent after every timeout |
| PaymentMethod / SetupIntent | Tokenized method and setup flow | Is future usage authorized and configured correctly? | Collecting raw card numbers in application forms |
| Charge | Payment attempt information within modern flows | What charge is linked to this payment/refund/dispute? | Building new acceptance flows using legacy charge creation |
| Invoice | Receivable and billing document | Is it draft, open, paid, void, or uncollectible? | Confusing a refund with correcting an invoice |
| Subscription | Recurring agreement and lifecycle | Which items, dates, collection rules, and status apply? | Equating `active` with all historical invoices being paid |
| Refund | Return of funds against a payment | What amount has been requested and what is its actual status? | Treating submission as completed settlement |
| Dispute | Cardholder/issuer challenge | What is the deadline, reason, amount, and evidence requirement? | Refunding independently while a dispute is in flight |
| Balance Transaction | A movement in the Stripe balance | What gross, fee, net, currency, and availability apply? | Summing charges and calling the result bank cash |
| Payout | Transfer of eligible balance to an external account | Which settlement movement reached the bank? | Assuming a payout equals one sale |

## Payment state is asynchronous

A custom PaymentIntent flow must distinguish missing payment details, required customer action, ongoing processing, authorized-but-uncaptured funds, successful payment, and cancellation. The UI should display actionable messages; your server makes the fulfillment decision using a verified current resource and your policy. A client secret enables a client flow and must not be exposed to another customer or logged.

For Checkout, keep a pending state while delayed methods resolve. Handle both completion and asynchronous success. A completed session with `payment_status='unpaid'` must not unlock paid goods. A zero-cost or trial scenario can legitimately be `no_payment_required`; entitlement rules must explicitly account for it. See [payment-status verification](https://docs.stripe.com/payments/payment-intents/verifying-status) and [Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment).

Example application states:

```text
order:    created → checkout_pending → payment_confirmed → fulfilled
                               └──→ expired / payment_failed
payment:  separate record of processor status and timestamps
delivery: pending → accepted_by_provider → delivered / exception
```

Do not roll `fulfilled` back to `pending` because an old event arrives. Refunds and disputes are compensating business events, not rewrites of the original delivery history. A shipped item remains shipped even if money is later returned.

## Invoice and subscription decisions

Invoice draft content can change before finalization. An open invoice is a receivable awaiting settlement. Paid, void, and uncollectible have distinct accounting meanings. Void cancels the obligation under the applicable workflow; uncollectible records that it will not be collected. Do not mark paid outside Stripe merely to remove an overdue badge. Use that action only when an authorized, evidenced payment occurred elsewhere. See [invoice transitions](https://docs.stripe.com/invoicing/integration/workflow-transitions).

A subscription can be trialing, incomplete, active, past due, unpaid, paused, canceled, or incomplete-expired. Cancellation scheduled for period end is a future instruction, not necessarily immediate termination. Pausing collection differs from a subscription whose status is paused. Implement an explicit access policy rather than a single `isPaid` boolean. See [subscription lifecycle](https://docs.stripe.com/billing/subscriptions/overview).

Suggested application policy, requiring product approval:

| Observed condition | Candidate access policy | Additional evidence |
| --- | --- | --- |
| Eligible trial | Trial-scoped access | Trial end, abuse checks and contract |
| First payment incomplete | Keep activation pending | Required action / payment result |
| Current billing accepted | Paid features | Contract, subscription items, relevant invoice or entitlements |
| Renewal past due | Time-limited grace | Dunning settings, customer tier, recovery deadline |
| Unpaid or terminated | Restrict new paid usage | Retention/export policy and legally required access |
| Scheduled cancellation | Continue to agreed boundary | Effective end time per item/contract |
| Dispute or suspicious activity | Risk review | Never infer fraud solely from the presence of a dispute |

This table describes product choices, not automatic Stripe behavior. Never send an API request that attempts to set an arbitrary subscription status such as `past_due`.

## Data boundaries

Keep a table mapping tenant, Stripe account, environment, and Customer ID. Use explicit subscription/order tables for your own concepts. Avoid hidden reliance on email, name, or mutable metadata as an authorization boundary. Metadata may help investigation; it is not a secure tenancy directory.

Suggested application records include `billing_customers`, immutable `order_attempts`, `subscription_contracts`, `entitlement_grants`, `refund_requests`, and `finance_adjustments`. These are host-application tables; SafeStripe does not silently create a full commercial schema for you.

Map asynchronous events through the Stripe object graph to your known Customer, Subscription, payment, or Checkout Session. If a webhook arrives before the API response has been bound, retry processing or reconcile the operation. Do not guess the tenant and grant access. SafeStripe's example intentionally retries an unknown Checkout Session until its mapping is established.

## Design review questions

Before accepting an integration, ask: Can two browser tabs buy twice intentionally? Can they accidentally create two attempts for one immutable order? Who decides which is allowed? What happens if the payment succeeds after the order expires? Which system can approve a refund? How is that decision represented after the approver leaves the company? What does the customer see while the financial state is unresolved?

Answers should identify records, transitions, owners, and recovery paths. “Stripe handles it” is not an answer to a question about your own business state.
