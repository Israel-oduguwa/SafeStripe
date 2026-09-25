# Design for a larger application

A larger payment system needs the same basic guarantees as a small one, under more concurrency and more partial failures. SafeStripe provides reusable controls for the billing boundary. Your organization still needs capacity measurements, operational ownership, access control and a recovery plan.

This release has no published throughput benchmark. Test the design against your expected peak load and recovery requirements before choosing worker counts or database capacity.

## A practical deployment shape

```text
Browser / mobile application
  → authenticated API (Express or Next.js)
  → order ownership + catalog + authorization policy
  → SafeStripe operation record
  → Stripe API

Stripe webhook
  → signature / scope / version / body validation
  → durable inbox
  → bounded workers
  → current Stripe resource + stored order verification
  → one database transaction: billing state + effect + outbox
  → outbox workers
  → idempotent fulfillment / notifications / accounting services

Scheduled reconciliation
  → Stripe resources and balance movements
  → application records and ledger
  → discrepancy queue for investigation
```

Web replicas are replaceable. The shared billing database carries the state. Webhook requests do only verification and durable admission; workers own the slower business logic. External systems receive explicit, replayable messages.

## Start with one billing owner

Create a billing service/module that owns Stripe credentials, operation identities, customer mappings and event processing. Other services request an intended action using a stable business ID. They should not independently retry direct Stripe mutations with newly generated keys.

Define a supported command contract: who can request it, the amount/currency or catalog terms, the tenant, the relevant resource mapping, and the acceptable state transition. Persist these terms before accepting a commercial order. Treat approvals, refunds and subscription edits as separate workflows with their own permissions.

For Connect, derive connected accounts from an authorized server mapping. Partition worker routing by the complete account/mode scope. Do not use a client-provided account header to select arbitrary tenants' payment accounts.

## Choose a transactional boundary

Keep a small billing record in the same storage transaction as its effect guard and outbox message. Your order catalog may be elsewhere, but a reliable paid-state decision needs a durable binding between the accepted terms and Stripe resource.

Cross-database updates are not atomic. If your main app uses Firebase but billing uses PostgreSQL, write an outbox message and apply it idempotently in Firebase. Do not call two independent writes and describe them as a transaction. If you use the Firestore adapter for both billing records and effects, stay inside the supplied `BillingTransaction` API for this atomic work.

Native SQL helpers (`effectOnce`, `refreshProjection`, SQL reconciliation) belong to the legacy PostgreSQL API. Portable transactions use `tx.get`, `tx.set`, `tx.effectOnce` and `tx.enqueue`. They cannot run arbitrary MongoDB or SQL writes in the supplied transaction. Extend an adapter deliberately if your application needs a different atomic boundary.

## Control concurrency before adding replicas

```ts
import { ConcurrencyGate, createSafeStripe } from '@israeloduguwa/safestripe';

const billing = await createSafeStripe({
  secretKey: process.env.STRIPE_SECRET_KEY!,
  storage,
  appOrigin: process.env.APP_ORIGIN!,
  authorize: billingPolicy,
  gate: new ConcurrencyGate(8, 32, 5000),
  observer: (event) => metrics.record(event),
});
```

These limits apply to **one process**. Ten processes with a limit of eight can issue far more requests than one process. Implement the `ExecutionGate` interface using your organization's distributed quota service if you need an account-wide budget. The package does not install Redis or a broker for you.

The SDK retries selected transient network failures, with bounded request timeouts. Application retries still use the same operation identity. Classify `BUSY`, upstream failures, payload conflicts and review-required states separately. Do not run an unbounded retry loop or reset operation history to resolve a timeout.

Portable queue claims read a bounded group of due candidates, then try transactions. Under heavy contention, many workers can examine the same candidates. Tune worker count and partition by independent account scopes; benchmark hot scopes. The original PostgreSQL queue uses `SKIP LOCKED` for its claim path and remains available to existing SQL integrations. There is no automatic broker connector or universal throughput guarantee.

## Process events as notifications of state

Stripe can deliver an event more than once and events can arrive out of order. The inbox deduplicates event IDs; a business effect key handles two different events that describe the same fulfillment. Those are different checks.

Retrieve the current resource and verify it against the stored binding. Commit the decision while maintaining a transaction dependency on the affected billing record, so concurrent state refreshes cannot blindly overwrite one another. Keep remote reads bounded. Database transaction retries may repeat reads; do not put new financial writes inside the handler transaction.

For subscriptions, define an entitlement state machine covering payment recovery, pending plan updates, cancellation, pause/resume, trial end and asynchronous invoice settlement. Reconcile it periodically. A boolean called `hasPaid` is insufficient for a recurring product.

## Monitor customer impact

Record the age of the oldest pending job, not just job count. Ten delayed fulfillment events may matter more than a thousand harmless subscription refreshes. Measure webhook acknowledgment latency, worker duration, retry counts, dead jobs, operation review count, database contention and Stripe request errors.

The observer emits bounded metadata and safe error classifications. It intentionally avoids payloads and raw database/Stripe error messages. Do not attach client secrets, customer emails or card data when forwarding those events to logs. Avoid unbounded tenant/resource IDs as metric labels; use protected traces or audit records for investigation.

Set alerts from an explicit service objective. For example, choose how quickly a successful payment should become available to the customer, then budget webhook delivery, queue delay and processing latency against it. The number is your product's objective, not a package default.

## Prove a recovery path

Exercise a network timeout after Stripe accepts a mutation, a crash after webhook admission, a crash after remote fulfillment acceptance, expired worker ownership, wrong event versions, database failover and restore from an older backup. Verify that money-changing work does not silently replay as a fresh action.

An unresolved operation beyond the default 23-hour retry window enters review. Investigate the remote object before resolving it. Replaying a dead job should identify an authenticated operator and reason. Preserve that audit trail and the original operation identity.

Database restoration can erase knowledge of remote actions that still exist in Stripe. Freeze uncertain writes, reconcile affected intervals, restore bindings/effect history and obtain an operational sign-off before normal processing resumes. A backup restore by itself does not restore agreement between two systems.

## Establish capacity with measurements

Build a load profile from your business: new checkouts, subscription renewals, failed-payment bursts, refunds, webhook replay storms and slow downstream services. Test the database adapter you will actually deploy, with representative payload sizes and account-scope concentration.

Start at expected peak, include a defined burst factor, and measure p50/p95/p99 API latency, queue age, duplicate-effect count, transaction retries, CPU, memory, database connections and storage/read costs. Inject provider throttling and temporary outages. The acceptance criterion must include zero extra committed business effects and a bounded recovery time, not merely requests per second.

Use sandbox or synthetic workloads that respect Stripe's testing and rate-limit guidance. Do not benchmark against live customer payments. Document the tested hardware, region, database tier, SDK version and concurrency so the result can be reproduced.

## Production readiness is a release decision

Before enabling live payments, complete sandbox end-to-end checks, tenant-isolation tests, database-specific integration tests, secret rotation, incident drills, retention/backups, access reviews and the relevant payment/security assessment for your business. Independent security review and real payment-method/browser testing remain outside a library build's guarantees.

For day-to-day operations, continue with [security and scaling](07-security-and-scale.md), [financial workflows](04-billing-and-finance.md) and [testing/runbooks](08-testing-and-runbooks.md).
