# Billing and financial engineering

## Money is a typed quantity

Represent API amounts as integer minor units and always carry the currency. USD 10.00 is commonly represented as `1000`; a zero-decimal currency follows different scaling, and Stripe has special rules for some currencies and payout contexts. Do not apply a universal multiplication by 100. Read the current [currency rules](https://docs.stripe.com/currencies).

Validate amount syntax at the edge and business bounds in the service. An integer of 10 million might be syntactically valid and commercially wrong. SafeStripe validates positive safe integers for its amount-taking methods; it does not claim to validate every currency's processor minimum, maximum, or your approval limit.

Use database `bigint` or appropriate exact decimal types for aggregation, and `BigInt` for integer comparison beyond JavaScript's safe range. Never sum different currencies into one total. FX conversion requires the actual rate, effective time, rounding policy, and a separate gain/loss treatment.

## Proration is a quote workflow

For a seat upgrade, persist a change proposal containing subscription ID, item ID, new Price ID, quantity, proposed effective time, and the timestamp used for proration. Preview through `invoices.createPreview`, show the result, and record acceptance. Apply the same timestamp and intended parameters when updating the subscription. Re-fetch after the change and reconcile the actual invoice.

An identical proration timestamp addresses one source of drift; it cannot freeze future taxes, discounts, exchange rates, usage, or concurrent edits. Give quotes an expiry and a clear acceptance policy. Do not promise an exact final invoice solely because the preview succeeded. See [invoice preview](https://docs.stripe.com/api/invoices/create_preview) and [prorations](https://docs.stripe.com/billing/subscriptions/prorations).

SafeStripe's `previewSubscriptionChange` and `updateSubscription` share the same explicit input shape. The update requests immediate invoicing with a pending update if collection is incomplete. This policy fits paid upgrades; it is not a universal downgrade or renewal policy. Pending updates have eligibility and field restrictions that must be tested for your payment methods and billing configuration.

The library verifies that the item belongs to the specified subscription. The application must additionally serialize competing commercial changes, verify the quote is still current, and authorize the new Price and quantity. Two accepted proposals with different operation IDs can both run unless your contract table prevents it.

## A worked upgrade review

A fictional customer has five seats. They request eight seats halfway through a period. Do not calculate “three seats times half the monthly price” and bill that amount yourself. That mental estimate is useful for detecting gross errors, but discounts, tax behavior, billing mode, and precise timestamps can change the invoice.

The approver should see: old and new seat counts, effective time, previewed debit or credit, currency, tax treatment, collection behavior, and what happens if payment needs authentication. The engineering record should bind those facts to an immutable proposal ID. After execution, verify the resulting item quantity and the invoice state independently.

## Off-session authentication and recovery

Collect consent and set up the payment method for its intended future use. A later off-session payment can still require the customer's participation. Do not interpret that as a permanent card failure or silently issue unrelated PaymentIntents until one succeeds.

For subscription invoices, process payment-failure and action-required events, retrieve current state, and enqueue a customer recovery intent. Let the customer return through an authenticated page or appropriate Stripe-hosted flow. Avoid putting secrets or full billing data in notification URLs. Re-check the invoice before sending a reminder; a delayed job may refer to an already paid invoice.

Stripe Billing controls collection attempts and subscription status according to configuration. Your application controls the grace period and access policy. These are separate state machines. Review [subscription webhook events](https://docs.stripe.com/billing/subscriptions/webhooks) and [subscription payment behavior](https://docs.stripe.com/billing/subscriptions/overview).

## Invoice changes, refunds, and credits

A refund returns money against a payment. A credit note adjusts an invoice under the applicable billing/accounting workflow. Canceling a subscription changes future service/billing behavior. These operations can be related, but none is a substitute for the others.

Refund approval should identify the original payment, refundable amount, prior refunds, reason, approving actor, and whether a dispute is open. Use a business refund-request ID as the operation identity. Distinct approved partial refunds need distinct IDs. Stripe can enforce processor limits, but your system still needs approval controls and reconciliation when an operator also issues a Dashboard refund.

Refunds may remain pending or fail. Account for their actual status and related balance movements, not just the success of the create API call. Consult [refund behavior](https://docs.stripe.com/refunds) before designing settlement notifications.

## A ledger example

The following is a simplified accounting design example, not an automated posting policy shipped by SafeStripe. Assume a USD 100.00 sale with an illustrative USD 3.20 processing fee:

| Journal event | Debit | Credit |
| --- | --- | --- |
| Payment settles into processor receivable | Stripe clearing 100.00 | Sales or deferred revenue 100.00 |
| Processing fee recognized | Processing expense 3.20 | Stripe clearing 3.20 |
| USD 96.80 payout arrives | Bank cash 96.80 | Stripe clearing 96.80 |

Each journal must balance within a currency and accounting entity. Subscription revenue may be deferred and recognized over time according to your accounting policy. Refunds and disputes add compensating entries; they do not edit historical journal lines. Use unique source references to prevent duplicate posting, explicit journal versions, and approvals for manual adjustments.

SafeStripe includes balance-transaction ingestion and comparisons. It does **not** include a complete double-entry engine, chart of accounts, revenue recognition, FX accounting, or bank feed. Building those incorrectly is worse than making their boundary explicit.

## Reconciliation design

Use three independent comparisons:

1. **Application versus processor:** expected orders, refunds, and subscription obligations versus actual Stripe resources. Investigate missing or duplicated objects and mismatched amounts.
2. **Processor movement versus journal:** every relevant Balance Transaction has one classified journal source; gross, fee, net, currency and account agree.
3. **Processor versus bank:** payouts, reversals, timing differences, fees, and actual bank receipts reconcile.

Scan fixed UTC windows using half-open ranges `[from, to)`. Persist a successful window checkpoint only after all pages finish. If a scan fails halfway, repeat the window and upsert by identity. Refresh pending movements and overlap recent windows to catch availability changes; do not depend on a once-only daily scan. Long-term backfills and exception handling require an operator-owned schedule.

Stripe's [Balance report](https://docs.stripe.com/reports/balance) explains balance activity, while the [Payout reconciliation report](https://docs.stripe.com/reports/payout-reconciliation) associates eligible automatic payouts with their transactions. They answer different questions. Document report timezone, currencies, filters, and row completeness when comparing them.

`importBalanceTransactions` streams API pages and records movements. `reconcile` compares supplied expected and actual rows using exact integers. Neither schedules itself, invents the expected ledger, closes accounting periods, or repairs differences automatically.

## Connect and financial responsibility

Choose Connect architecture from the actual commercial relationship, account configuration, charge ownership, and loss responsibility. New account design should follow Stripe's current Accounts v2 guidance. Dashboard access, fee collection, and negative-balance responsibility are distinct dimensions. Consult [SaaS account setup](https://docs.stripe.com/connect/saas/tasks/create) and [marketplace setup](https://docs.stripe.com/connect/marketplace/tasks/create).

Direct charges, destination charges, and separate charges/transfers produce different money paths. A platform-side refund does not automatically imply the desired connected-account recovery. Separate transfers require explicit tracking of transfer/reversal relationships; fee retention is modeled in transfer amounts, not an application-fee field on that separate-transfer operation. See [separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers).

Before releasing funds, evaluate available balance, pending liabilities, dispute exposure, contractual reserve policy, account capabilities, and permissions to control payout timing. A `balance.available` event is an input, not a universal authority to freeze a seller's money. Negative balances do not imply one fixed debit behavior across all Connect arrangements.

SafeStripe scopes ordinary API requests and snapshot webhooks to a configured connected account. It does not implement Accounts v2 onboarding, capability management, organization events, transfer reversals, payout controls, or seller reserve calculations. Those require a platform-specific design and separate tests.

## Tax is explicit configuration

The examples do not enable automatic tax. Before adding it, establish the applicable tax obligations, registered jurisdictions, liable entity, product classification, price tax behavior, and customer location. Confirm active registrations in the intended Stripe environment; merely enabling a flag does not establish collection everywhere. Inspect taxability reasons in sandbox calculations, including valid zero-tax cases. See [Stripe Tax setup](https://docs.stripe.com/tax/set-up) and [testing Stripe Tax](https://docs.stripe.com/tax/testing).

Registration, calculation, collection, reporting, filing, and remittance are different responsibilities. Obtain the appropriate tax advice for the business and region. A technical wrapper cannot decide legal liability or repair historical tax treatment by changing a future Checkout setting.

## Usage billing and large SaaS contracts

Keep usage measurement separate from monetary settlement. Define event identity, allowed lateness, aggregation windows, corrections, tenant ownership, credit consumption, and invoice finalization boundaries. Duplicate usage is a billing defect, even if the payment itself is perfectly idempotent.

Stripe's current guidance recommends evaluating Metronome for new usage-based systems; existing Billing Meters integrations have their own supported paths. SafeStripe does not implement either metering engine. Preserve fixed-fee subscription and customer mappings when adding usage rather than automatically canceling the existing commercial agreement. Review current product documentation before selecting a metering API.
