# Payment lifecycle verification

A successful API request is only one step in a payment. The public lifecycle suite follows the payment through Stripe, the signed webhook endpoint, the worker and the saved Firestore state.

It uses the published `safestripe@0.3.0` package in the deployed demo. The test runner comes from this repository. Those are separate revisions: the report records the runner commit, backend commit and installed package version. A passing run does not verify an unpublished package built from a newer source commit.

## The journeys

| Journey | What the test must establish |
| --- | --- |
| Hosted card purchase | Chromium completes Stripe Checkout; the real signed event creates a Firestore receipt for the approved customer, order, Session, USD amount and currency |
| Duplicate delivery | The official Stripe CLI requests ten replays; ten additional authenticated duplicate admissions are recorded, while the original receipt and paid time remain unchanged |
| Decline and retry | An insufficient-funds card leaves the order unpaid; a successful retry uses the same Checkout Session and produces its receipt |
| Partial refund and replay | A 250-cent refund succeeds and reaches its signed Firestore state; retrying its business operation returns the same refund |
| Remaining refund | A second 250-cent refund closes the original 500-cent payment; Stripe's charge shows the full refunded amount while the original sale receipt remains intact |
| Bank payment processing | An ACH fixture remains processing with no received amount; cancellation is saved after Stripe's signed event |
| Bank payment success | The ACH fixture starts processing, later succeeds remotely and reaches the signed Firestore state with the expected received amount |
| Bank payment failure | The ACH fixture starts processing, later fails remotely and reaches the signed failure state without a received amount |
| Subscription start | A saved test payment method pays the initial subscription invoice; the signed invoice event updates Firestore |
| Failed renewal and recovery | A test clock reaches the next period, the renewal actually fails, and a corrected method pays that invoice |
| Out-of-order delivery | The actual paid-invoice event arrives before the earlier failed-invoice event; the latter retains its old snapshot but cannot replace the current paid state |
| Cancellation | Stripe cancels the fixture subscription; the signed event produces the durable canceled state |

The delayed bank fixtures use Stripe's test tokens and synthetic mandate details. The runner creates and confirms its own ACH PaymentIntents through the Stripe SDK, then checks their genuine signed deliveries through the published SafeStripe receiver, worker and Firestore adapter. These checks verify asynchronous admission and saved state; they do not verify an ACH creation or confirmation command in the wrapper. The wrapper's creation command returns an unconfirmed intent using the account's dynamic payment methods. No real bank account or customer information is used. The suite does not change merchant-wide payment settings or enable products on an account; its sandbox must be eligible for ACH Direct Debit. See [Stripe's ACH test options](https://docs.stripe.com/payments/ach-direct-debit/accept-a-payment?payment-ui=direct-api&web-or-mobile=web).

The separate [service suite](27-release-evidence.md) verifies customer response loss and replay, hosted and Elements Session creation, refund replay, subscription creation and portal ownership. The public Elements walkthrough includes a card decline and a completed authentication challenge. Synthetic regression tests exercise rollback, worker ownership and stale snapshots; they are retained separately from real Stripe observations.

## Run the public suite

Use the dedicated disposable sandbox configured for the [protected service workflow](27-release-evidence.md). The lifecycle workflow also needs customer, catalog, PaymentIntent, subscription, invoice, refund, payment method, Test Clock and Webhook Endpoint access. A standard test secret key requires an explicit `secret` selection. Neither secret nor restricted test keys are public credentials.

1. Deploy the reviewed demo revision on Render and Vercel. Its authenticated status response includes the backend's Render commit and installed npm version.
2. Open **Actions → Public Stripe payment lifecycle → Run workflow** on `main`.
3. Set `demo_commit` to the full deployed backend commit and select the configured key type.
4. Review and approve the protected `stripe-sandbox` job. The workflow installs Chromium only on its isolated CI runner.
5. Inspect the `stripe-lifecycle-report` artifact. All twelve checks, account verification, matching deployment and fixture cleanup must pass. A timeout, unavailable payment method or permission error is a failure, not a passing skip.

The runner creates its own customer, prices, webhook destinations and two private demo workspaces. It never uses an existing visitor's payment records. The public frontend proxy carries authenticated API calls; Stripe delivers signed events directly to the Render endpoint. The runner holds workspace cookies in memory. Keys, signing secrets, Checkout URLs, client secrets and raw customer payloads are excluded from its output.

The card journey, each bank outcome and the subscription journey run independently after shared setup. A browser failure does not hide the bank and renewal checks. Card replay runs after decline and refund checks so a delivery timeout does not prevent those checks. The report retains every failed checkpoint and the checks that completed; any failure keeps the overall result failed. All twelve checks and cleanup are required for a passing run.

Refunds or cancellations close the one-time payment fixtures. The runner deletes its webhook endpoints, disconnects its demo workspaces, deletes synthetic customers and test clocks, and archives its prices and products. Stripe keeps financial history. A private fixture journal is written before creation and updated atomically as resource IDs are received. Its one-day artifact contains no credentials. If the process stops before a creation response arrives, the journal's run ID can identify tagged Stripe fixtures. Lost browser cookies cannot be recovered from it; interrupted public workspaces use the server's one-hour expiry and cleanup. Do not treat an interrupted run or failed cleanup as complete.

The official CLI replay runs with closed input and a bounded native process. The runner validates each returned sandbox Event before discarding its payload; an API error cannot pass merely because the process exits successfully. The report keeps only identity-validation results and numeric delivery counts. It observes each duplicate admission before requesting the next replay, with a shared three-minute deadline. Ten additional duplicate admissions are required before counting replay as passed.

## How the demo avoids stale state

An event describes the object when that event was created. A failed invoice snapshot may arrive after the invoice has been paid. The demo reads Stripe's current object and writes that status to a customer-scoped Firestore record. It reads the shared record before the remote lookup so competing transactions conflict and retry rather than silently commit an earlier read after a later one.

The original snapshot status remains in the minimal event record for diagnosis. The saved current status drives the aggregate record. Your application still supplies its own entitlement policy: an active subscription does not automatically authorize every product or user.

For the ordered invoice check, the runner temporarily enables only `invoice.paid` on its own fixture endpoint. It waits for that durable paid record and verifies that the older failure has not been admitted. It then restores the fixture's event list, requests the older signed failure and requires its saved timestamp to be later than the paid record. The report keeps those timestamps without event or invoice identifiers. Resend request order alone is insufficient evidence of receiver order.

Signed admission counts are demo diagnostics. They add a transaction after the inbox write and before acknowledgment. If that diagnostic fails, Stripe gets an error and can retry; the inbox job is already durable. Business effects and receipts use their own keys and transaction boundaries. An increased delivery count does not represent another payment or fulfillment.

## Coverage boundaries

This is selected lifecycle coverage, not a claim that every Stripe capability or payment method has been tested. Manual capture and partial capture, disputes, reversal policies, failed refunds, subscription schedules, pause/resume, tax decisions, Connect money movement and country-specific methods need their own application scenarios. The package does not currently expose a dedicated capture or dispute-management command. Do not replace those gaps with synthetic events and describe them as real end-to-end tests.

Production review also needs the application's authorization and fulfillment rules, its database restore procedures, actual infrastructure limits and independent security review. The public Render service is an evaluation environment; these checks are not a capacity or uptime commitment. See the [release assessment](28-release-readiness.md).

## Recorded results

On 7 October 2026 at 09:32 UTC, [the protected workflow](https://github.com/Israel-oduguwa/SafeStripe/actions/runs/37600727941) passed all twelve journeys, remote account verification and fixture cleanup. The [original sanitized report](evidence/stripe-lifecycle-2026-10-07.json) identifies clean runner revision `a79d70b`, deployed demo revision `8b01d90`, published `safestripe@0.3.0`, Stripe SDK 22.6.2, API `2026-08-26.dahlia` and Node 22.23.3.

The card event's admission count rose from one to eleven, with ten duplicates. Its receipt and original paid time stayed unchanged. A declined card recovered in the same Session. Two 250-cent refunds closed the original 500-cent charge; replay returned the first refund and Stripe retained only two refunds. All three delayed ACH outcomes and all four subscription checks passed.

The failed renewal event had not been admitted when the recovered invoice was already saved as paid. The paid record was written at `09:32:13.863Z`; the older failure was recorded at `09:32:18.782Z` with its original `open` snapshot, while the current invoice remained paid with 1,000 cents received. These are server observation times, not customer-facing payment timestamps.

An [earlier full run](https://github.com/Israel-oduguwa/SafeStripe/actions/runs/37599538772) passed at 09:21 UTC before the independent admission/timestamp assertion was added. The [attempt history](evidence/stripe-lifecycle-attempts-2026-10-07.json) retains both passing reports and eight failed runs. Hosted form selectors, dynamic bank-method configuration and unobserved duplicate deliveries failed during runner development; they were corrected and rerun. Failed attempts are not counted as passing coverage. Every retained attempt completed its fixture cleanup.
