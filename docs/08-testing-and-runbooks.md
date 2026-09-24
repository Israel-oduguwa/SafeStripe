# Testing, incident response, and release review

> The SQL implementation details on this page describe the original PostgreSQL API. For the portable SQLite, PostgreSQL, MongoDB and Firestore setup, start with [database adapters](15-databases.md) and [framework integration](16-frameworks.md). The current local sample defaults to SQLite; legacy SQL example commands use the `:legacy` suffix.

## Test layers establish different facts

| Layer | What it establishes | What it cannot establish |
| --- | --- | --- |
| Strict compilation | Internal type/API compatibility with installed declarations | Processor behavior or business correctness |
| Offline unit/contract tests | Identity, authorization, input, hashing and failure logic | Real Stripe account configuration |
| Embedded PostgreSQL tests | Executable SQL and transaction behavior on a PostgreSQL engine | Independent networked connections and deployment failure modes |
| Real PostgreSQL tests | Multi-connection claims, row locks, constraints and transaction behavior | Production topology, failover or capacity |
| Sandbox Stripe tests | Actual API permissions, resource schemas and simulated payment flows | Real issuer behavior, bank settlement or every production edge case |
| Production canary/reconciliation | Real operational and financial outcomes | Proof that every future case is safe |

The repository's tests exercise malformed signatures, tampering, secret rotation, scope and API-version rejection, duplicates, distinct events producing the same effect, rollback, stale workers, review cutoff, outbox ambiguity, reconciliation and framework adapters. Use `VERIFICATION.md` for the exact executed results.

## Failure-injection matrix

| Experiment | Expected behavior | Evidence |
| --- | --- | --- |
| Send identical event ten times | One inbox identity | Unique event row; duplicates acknowledged |
| Send two event types for one order | One local fulfillment | One business-effect key and one delivery intent |
| Change price under same operation ID | Conflict before new API mutation | `PAYLOAD_CONFLICT`; unchanged remote-call count |
| Interrupt after remote success | Retry original key | Same remote object; no second purchase |
| Crash after claim | Lease can be reclaimed | New fencing token; old token cannot commit |
| Throw after local write | Transaction rolls back | No partial effect or notification intent |
| Stop database at ingress | Non-success response | No falsely acknowledged event |
| Deliver older subscription event last | Current state preserved | Projection reflects current retrieval |
| Cross tenant/customer/account | Denied | No remote write, no leaked response |
| Restore backup before payment | Manual recovery boundary | Reconciliation completes before writes reopen |
| External recipient accepts then disconnects | Same delivery key on retry | Recipient deduplication prevents second effect |
| Repeated poison job | Dead letter after budget | Visible state and operator-owned replay |

Sandbox exercises should additionally cover authentication-required cards, declined payments, delayed methods, trial transitions, renewal failures, partial refunds, pending refunds, subscription changes and tax configuration. Keep deterministic fixtures separate from recordings and manual experiments. Use test clocks for eligible recurring scenarios; real-time waiting is slower and less reproducible.

## Runbook: paid customer, missing service

First establish the payment identity, account and environment. Read the order's session binding and current Stripe state. If the payment is not actually successful under the product's policy, explain the pending condition rather than forcing access.

If payment is confirmed, inspect the event's delivery history, inbox row, job attempts, dead-letter state and business-effect guard. A transport failure needs delivery repair; a stopped worker needs worker recovery; an unknown session mapping needs command reconciliation. Use the same transactional business handler for repair. Verify exactly one resulting fulfillment and one external delivery identity.

Do not create another payment or delete the guard. If a manual action is necessary, record the operator, reason, supporting IDs and approved procedure. Communicate the observed outcome without claiming bank settlement or service delivery beyond the evidence.

## Runbook: operation requires review

Locate the durable operation by scope, tenant and operation ID. Inspect Stripe request logs and the associated business record. Determine whether the operation created a remote object, failed before execution, or remains uncertain. Search is supporting evidence; absence from an eventually consistent search result is not proof of no side effect.

If the exact successful resource is proven, verify its account, tenant mapping and immutable commercial parameters, then invoke the privileged review-binding action with actor and reason. If no remote mutation can be established conclusively, keep the case open or follow an approved new-attempt policy. Do not simply shorten timestamps, reset the row, or allocate another ID until the uncertainty is resolved.

SafeStripe's `resolveForReview` records the claimed resolution and an audit entry. It trusts the privileged caller's investigation; it does not perform the remote proof itself.

## Runbook: signature failures

Check whether Express parsed JSON before the webhook route, whether a proxy altered or decompressed the body, whether the configured secret belongs to the listener/destination, and whether clocks are synchronized. Confirm mode, account, API version and snapshot versus thin payload. Inspect safe error metrics without dumping payloads or secrets.

Deploy the correction, validate a new signed request, and replay legitimate missed events. Do not change the route to accept unsigned JSON or disable checks to clear an alert. If a webhook secret was exposed, rotate it and investigate which false events might have been admitted during exposure.

## Runbook: duplicate fulfillment or refund

Stop the affected business mutation path if the defect is ongoing. Preserve operation rows, effects, event records, logs and approvals. Determine whether the duplicate arose from two business IDs, two different events sharing no business guard, missing transaction boundaries, a lost database history, or an operator action outside the application.

Scope affected customers using business/financial identities rather than raw event counts. Reconcile remote payments and local effects. Any compensation is a new authorized action with its own identity and audit trail. A duplicate charge may require a refund; duplicate fulfillment may require a different commercial remedy. Do not automatically compensate without understanding the actual side effects.

## Runbook: backlog or rate-limit incident

Measure arrival rate, processing rate, oldest age, Stripe latency, database pool wait and errors. Pause nonessential imports and backfills. Reduce retry amplification. Increase workers only when the dependency and database can absorb the added concurrency. If one resource is hot, more workers may worsen lock contention.

After recovery, calculate how long the backlog will take to drain and prioritize financially sensitive work. Verify no jobs aged out of their recovery window and that invoices or entitlements were not left inconsistent. Review the incident against the service objective, not just whether CPU returned to normal.

## Runbook: key or recording exposure

Revoke or rotate the exposed credential through the authorized Stripe/security process. Restrict the exposed recording or artifact, preserving evidence according to the incident policy. Inspect relevant request history and financial actions. Rotate dependent credentials only where the incident scope warrants it, and validate services with replacement credentials.

Do not rely on deleting a repository commit or blurring a new video copy to revoke a secret. Record the exposure window and affected capabilities. The repository's secret check is an additional guard, not an incident detector or a substitute for key management.

## Production release review

The release owner should verify a concrete implementation of authentication and billing authorization; approved tax and entitlement policies; restricted credentials; database backup/restore; durable ingress; supported event inventory; outbox consumer; reconciliation schedule; monitoring and on-call ownership; and a sandbox flow for every offered payment method.

Inspect the exact artifact being released: lockfile, API version, migration set, route configuration, secret injection, worker concurrency and retention jobs. Review pending updates and historical events before a version upgrade. Deploy gradually, inspect real outcomes, and preserve a rollback path compatible with data already written by the new version.

Do not label unexecuted cloud CI, a proposed load target, or a sandbox-only result as a completed production validation. Evidence should distinguish design, implementation, local testing, external-system verification and live operation.
