# What SafeStripe solves

The Stripe SDK can create a payment object in a few lines. The difficult part comes when your application cannot tell whether those lines finished.

A customer clicks twice. Your server times out after Stripe accepts a refund. Two webhook events describe the same purchase. A deployment stops a worker between updating an order and notifying another service. These are ordinary failure modes in payment systems, even when every API call is written correctly.

SafeStripe gives these situations a durable identity, a recovery path, and records that an operator can inspect. This guide explains the controls individually, what they save you from building, and the decisions that still belong in your application.

## 1. Retrying a request without creating another purchase

**Example:** A customer buys a $40 product. Stripe creates the Checkout Session, but your server loses the response. The browser retries.

Without a stable operation identity, the retry can create another session. Hashing the cart does not solve the whole problem: the customer might intentionally buy the same product again tomorrow.

SafeStripe uses an operation ID supplied by your application, such as `checkout:order-184`. It derives a Stripe idempotency key from the account scope, tenant, operation ID, and action. It separately stores a fingerprint of the normalized input. The configured operation store binds that identity to one set of terms.

| Next request | SafeStripe behavior |
| --- | --- |
| Same operation and same terms, still in progress | Returns `BUSY`; the caller backs off |
| Same operation and same terms, retry allowed | Reuses the original Stripe idempotency key |
| Same operation already completed | Retrieves the recorded Stripe resource |
| Same operation with a different price or amount | Returns `PAYLOAD_CONFLICT` |
| New intentional purchase with a new operation ID | Creates a separate operation |

**What you supply:** A permanent business identity, approved terms, and an application record that links the result to the order. Keep the ID across browser, server, queue, and support retries. A newly generated UUID on every attempt removes the benefit.

**What changes for the developer:** Retry code no longer needs to guess from a timeout whether it should create a new object. It repeats the same command and lets the durable record determine the next step.

## 2. Handling an uncertain result after a long outage

**Example:** A refund request lost its response. The service was unavailable for two days. A support job now wants to retry it.

Stripe's idempotency records have a retention boundary. Reusing an old key after it has been pruned can execute another request. SafeStripe keeps its own operation record and defaults to a 23-hour automatic retry window, measured from the local operation's creation. After that window, an unresolved operation enters `review` and further mutation is blocked.

An operator then checks Stripe's request history and the associated payment. If the original refund exists, the privileged `resolveForReview` method can bind its resource ID to the operation and record the operator and reason. The application must verify that the resource actually belongs to the operation before calling this recovery method.

**What this prevents:** An outage recovery script that quietly issues another refund because an old key looks safe.

**What you supply:** Retention of the operation record, a restricted recovery tool, and an investigation procedure. Deleting the local history or restoring an older database snapshot can remove knowledge of a completed remote action. Reconcile after a restore before resuming financial writes.

Stripe documents its key retention and replay behavior in [Idempotent requests](https://docs.stripe.com/api/idempotent_requests).

## 3. Keeping a webhook after acknowledging it

**Example:** Your endpoint receives `checkout.session.completed`, returns HTTP 200, and starts a background promise. The hosting platform freezes the process before the promise finishes.

A successful HTTP response tells Stripe that delivery succeeded. It does not prove that your application's background work finished.

SafeStripe verifies the original request bytes, signature, account scope, mode, payload shape, and API version. It inserts the event into PostgreSQL before returning a successful response. A worker processes the stored record later. If storage fails, the endpoint returns an error so delivery can be retried.

**What this prevents:** A payment event disappearing because work was detached from a short-lived request.

**What you supply:** A reachable HTTPS endpoint, the correct signing secret, durable database infrastructure, and a running worker. Monitor the age of pending work. A healthy endpoint can continue accepting events while every worker is stopped.

## 4. Distinguishing duplicate delivery from duplicate fulfillment

**Example:** Stripe delivers the same event twice. Later, a different event and a manual repair job both refer to the same paid order.

There are two identities here. The inbox uses the event ID to suppress repeated delivery of one event. Your fulfillment code uses a business-effect key such as `tenant-a:order-184:fulfill` to suppress repeated fulfillment of the order.

`effectOnce` inserts that key within the worker's database transaction. The order update and the effect guard commit together. If the handler fails, both roll back, allowing a later attempt to finish the work.

**What this prevents:** Shipping twice or granting credits twice just because two valid events point to one purchase.

**What you supply:** The correct business key and the local writes made through the supplied transaction. Sending an email or calling a shipping API inside `effectOnce` does not make that remote service transactional. Use the outbox for those effects.

## 5. Recovering from a worker crash

**Example:** A worker claims an event and stops during deployment. Another worker needs to finish it.

SafeStripe jobs have a lease and a random ownership token. Once a lease expires, another worker may claim the job. The ownership token prevents an old worker from committing after ownership has changed. Local handler writes and the completion marker share a database transaction.

Failures retry with exponential backoff and jitter. Jobs reach a visible dead state after the attempt limit, including a crash on the last attempt. An authorized operator can replay a dead job after fixing its cause; the audit records who requested the replay and why.

The worker loop supports bounded concurrency and an abort signal. On shutdown, it stops starting work and waits for handlers already in progress. Configure network and database deadlines so that this wait has a practical bound.

**What this prevents:** Permanently stuck jobs after a crash, stale workers overwriting recovered work, and endless silent retries.

**What you supply:** Process supervision, alerts for dead jobs, bounded handler execution, and a policy for replay. More workers do not fix a handler that consistently rejects the same order.

## 6. Delivering work to another service

**Example:** An order is marked fulfilled, but the service crashes before asking the email provider to send the receipt.

The outbox stores the receipt intent in the same transaction as the order update. A separate dispatcher reads it, calls the destination, and records completion. The message carries a stable idempotency key.

There is still a possible gap: the destination accepts the message, but its response is lost. The dispatcher then sends it again. The destination must honor the key or provide an equivalent deduplication rule. SafeStripe provides at-least-once delivery, with enough identity for the recipient to make repeated attempts safe.

**What this prevents:** Losing a downstream task because a local commit and a remote request happened on opposite sides of a crash.

**What you supply:** An idempotent destination, a delivery function with a deadline, and recipient deduplication retention that covers your retry and replay period. A plain SMTP send has no automatic business-idempotency contract.

## 7. Keeping old events from restoring old state

**Example:** A subscription becomes active. An earlier event saying it was incomplete arrives afterward.

A handler that copies every event snapshot into the database can move the application's state backward. SafeStripe provides `refreshProjection`: it locks one resource's projection, fetches current state from Stripe, and updates the projection while holding that lock.

This favors a clear correctness rule over maximizing throughput. The network read holds a database connection and resource lock. Keep it short, disable layered read retries in that handler, and measure contention. At higher volume, consider partitioned processing by resource with an explicit refresh protocol.

**What this prevents:** Blindly overwriting current application state with an older event snapshot.

**What you supply:** The fields your product needs, a bounded retrieval function, and reconciliation. A projection is a current view. It is not a journal of every financial change or a full subscription entitlement policy.

## 8. Requiring permission checks at the payment boundary

**Example:** A logged-in user submits another organization's `cus_...` ID to create a billing portal session.

Stripe IDs are identifiers, not permission grants. SafeStripe requires an authorizer and calls it before wrapped commands, including replays. It supplies the account scope, actor, action, resources, and normalized parameters. Records are also scoped by account, environment, and tenant where appropriate.

The hook gives your application one place to check ownership and approved commercial terms. Strict input schemas reject extra fields, and Checkout return URLs come from a trusted configured origin.

**What this prevents when correctly configured:** A payment integration that treats possession of a resource ID as permission, accepts browser-selected prices without review, or trusts a request header to build a redirect origin.

**What you supply:** Authentication, tenant membership, resource mappings, approval limits, CSRF protection where needed, and a policy that denies unknown actions. An authorizer that always returns `true` disables the business-access boundary.

## 9. Limiting load instead of accumulating it

**Example:** A sale causes a burst of requests. Every incoming request starts a Stripe call, and the process accumulates work faster than it can finish.

The default concurrency gate permits eight active wrapped tasks, queues up to 32 more, and limits queue waiting to five seconds. Excess work receives `BUSY`. The worker loop has a separate concurrency setting. The official Stripe client has bounded timeouts and retries.

You can provide an `ExecutionGate` backed by a shared limiter or scheduler when several processes use one Stripe account. The default gate is local to one instance. Reuse it deliberately; creating a new gate per request defeats its limit.

**What this prevents:** Unbounded local request queues and uncontrolled retry fan-out inside one instance.

**What you supply:** Account-wide rate control, ingress limits, tenant fairness, connection budgets, and workload measurements. Raw SDK calls and handler reads need capacity controls too. The wrapper does not apply its gate to arbitrary SDK usage.

## 10. Investigating failures without logging payment payloads

**Example:** A refund fails in production. A developer adds `console.log(error)` and unintentionally logs customer data or request parameters.

SafeStripe's public errors use stable codes. Optional observer events include operation names, durations, outcomes, and selected failure metadata. Recognized Stripe error types and properly formed request IDs can help an operator find the corresponding request in restricted Stripe tools. Raw error messages, card fields, customer IDs, and payloads are excluded from the built-in diagnostics.

A telemetry callback can fail without changing a successful financial result. The library does not keep an unbounded telemetry queue; your exporter must be fast and bounded.

**What this prevents:** Treating logging as part of payment success or casually exposing full upstream errors to clients.

**What you supply:** A secure telemetry system, useful dashboards, alert routing, and careful labels. Application-defined job types should be fixed names, not customer data.

## 11. Checking whether financial records agree

**Example:** Your database says ten payments completed, but the Stripe balance report contains a refund and processing fees that your order totals omit.

`importBalanceTransactions` imports a fixed creation window from Stripe, follows pagination, and upserts scoped transaction IDs. Repeated imports refresh settlement availability. `reconcile` compares IDs, currencies, and exact `bigint` net amounts without floating-point rounding.

**What this helps you build:** A repeatable comparison that names missing, unexpected, or mismatched entries.

**What you supply:** The local financial model, scheduled overlapping imports, refreshes for older pending entries, discrepancy ownership, and bank or payout matching. These helpers are not a double-entry ledger, tax engine, or revenue-recognition system.

## Where SafeStripe fits

Use SafeStripe when payment workflows need durable coordination with PostgreSQL and you can run a worker. A SaaS billing service, marketplace back office, or order system can use the same primitives while enforcing different business rules.

For a simple payment link or a site without local fulfillment state, Stripe's hosted products may be enough. SafeStripe's portable adapters support SQLite, PostgreSQL, MongoDB and Firestore; another database needs a compatible transactional adapter. Organization-context events, thin events, complete Connect onboarding, dispute evidence submission, and full accounting are outside this release's wrapper surface.

The important review question is specific: does each control cover the failure your product can experience? The [architecture](02-distributed-architecture.md), [library reference](09-library-reference.md), and [verification record](../VERIFICATION.md) provide the details needed to answer it.

## 14. Starting without a database server

The portable SQLite adapter keeps the same operation and job API while storing data in one local file. A new developer can run a signed-webhook and fulfillment test without Docker. Shared PostgreSQL, MongoDB and Firestore adapters provide the same transaction-facing methods for deployment. Moving live history between stores is a deliberate migration; changing an environment variable does not copy that history.

## 15. Reducing payment-form wiring

`SafeCheckout` composes Stripe's custom Checkout provider, Payment Element and confirmation controls. An application supplies a server-created Session secret and may wrap an order summary inside the component. Prices, authorization and fulfillment stay on the server. It reduces repeated UI plumbing without pretending that an arbitrary HTML form becomes a secure card collector.

## 16. Keeping setup understandable

The SDK installs with the package. Account discovery removes a routine manual configuration step. Database drivers are selected explicitly, and only the React subpath belongs in a browser bundle. The separate consumer and maintainer guides keep package publishing instructions out of application setup.
