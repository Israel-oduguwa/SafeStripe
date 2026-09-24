# Library contracts and extension guide

## Portable API added in 0.2

| Export | Purpose |
| --- | --- |
| `createSafeStripe(options)` | Configure the SDK, resolve account scope and connect a portable store |
| `billing.storage` | Operations, jobs and application billing transactions |
| `billing.webhooks(options)` | Receiver bound to the same account and storage |
| `billing.worker(handlers)` | Worker whose handlers receive `BillingTransaction` |
| `sqliteStorage({ filename })` | Local Node SQLite file; `/storage/sqlite` |
| `postgresStorage({ db, migrate? })` | Portable SQL records; `/storage/postgres` |
| `mongoStorage({ client, database, collection? })` | MongoDB transactions; `/storage/mongodb` |
| `firestoreStorage({ db, collection? })` | Cloud Firestore transactions; `/storage/firestore` |
| `SafeCheckout` | React payment form; `/react` |

`SetupOptions` requires `secretKey`, `storage`, `appOrigin` and `authorize`. Optional fields include `accountId`, `connectedAccountId`, `allowLocalhost`, `gate` and `observer`. Account discovery makes one server API call per initialization. Cache the result/promise in your application.

Portable storage options are `leaseSeconds` (default 120; shared with operation and job leases), `retryWindowSeconds` (default 82,800, maximum 82,800) and `maxAttempts` (default 8). The combined store requires a lease of at least 30 seconds. Its JSON payload limit is 512,000 bytes. `BillingTransaction` offers `get`, `set`, `effectOnce`, `enqueue`, `scope` and a database-derived `now` timestamp. It does not expose arbitrary native database queries.

`createCheckout` accepts optional `uiMode: 'hosted' | 'custom'`; hosted is the default. A custom Session supplies the `client_secret` required by `SafeCheckout`. The frontend component accepts `publishableKey`, `clientSecret`, `children`, `appearance`, `className`, `style`, `buttonLabel` and optional display-only `onComplete`.

See [database setup](15-databases.md), [framework routes](16-frameworks.md), [payment UI](17-payment-ui.md) and [recipes](18-recipes.md). The reference below retains the original SQL classes for compatibility; they use separate tables and are not automatically migrated into portable storage.

## Core construction

Use `createStripeClient(key, livemode)` for the pinned SDK settings. Construct `PostgresOperations` and `PostgresJobs` with a `pg.Pool` or an implementation of the exported `Database` interface. Construct `SafeStripe` with the SDK, scope, operation store, trusted origin and mandatory authorizer.

```ts
const safe = new SafeStripe({
  stripe,
  scope: { platformAccountId, connectedAccountId, livemode: false },
  operations: new PostgresOperations(pool),
  appOrigin: 'https://your-application.example',
  authorize: yourBillingAuthorizationPolicy
});
```

This is an integration sketch; the fully executable composition is in `examples/shared/runtime.ts`. The authorizer receives `{ actor, scope, action, resources, parameters }`. Reject unknown actions and resource types. The normalized parameters differ by action: some are Stripe-style names such as `payment_intent`, while subscription-change proposals use `subscriptionId` and `itemId`. Validate the expected shape within your policy.

`Actor` contains `tenantId`, `actorId` and `operationId`. The actor identity is audited by your application; SafeStripe's command table stores tenant/operation identity but does not automatically record a full business approval history. Use a separate append-only audit mechanism for commercial decisions.

## Wrapped operations

| Method | Required input after actor | Semantics |
| --- | --- | --- |
| `createCustomer` | email; optional name | Durable create; replay can return a deleted-customer marker if deleted later |
| `createCheckout` | customerId, mode, items, reference | Hosted Checkout; server-configured success/cancel origin; dynamic methods |
| `createPaymentIntent` | customerId, amount, currency | Creates an unconfirmed intent; amount must be an authorized minor-unit integer |
| `createRefund` | paymentIntentId, amount; optional reason | Explicit partial/full amount; creation result is not bank settlement |
| `createInvoice` | customerId, daysUntilDue | Draft, manual collection, automatic advancement off, unrelated pending items excluded |
| `addInvoiceItem` | customerId, invoiceId, priceId, quantity | Explicitly attaches the item to a draft invoice |
| `finalizeInvoice` | invoiceId | Finalizes with automatic advancement off; does not explicitly send an email |
| `createSubscription` | customerId, priceId, quantity | Direct Billing flow with `default_incomplete`; application handles confirmation |
| `previewSubscriptionChange` | subscriptionId, itemId, priceId, quantity, prorationDate | Read/preview; checks item membership; no durable mutation record |
| `updateSubscription` | same proposal fields | Immediate invoice, pending update if payment incomplete; not a universal change policy |
| `cancelSubscriptionAtPeriodEnd` | subscriptionId | Sets the future cancellation instruction |
| `createPortalSession` | customerId | Fresh, authorized short-lived session; URL is not persisted by the operation store |

Except preview and Portal access-session creation, mutations use the durable command protocol. Stable operation IDs bind both method kind and normalized parameters. Reusing an ID for another method conflicts. Replays retrieve current resource state. They do not return a historical snapshot of the original result.

The library deliberately exposes the underlying official SDK for unsupported API calls. Calling it directly bypasses the wrapper's command protocol and authorization checks; do not claim those controls apply to arbitrary SDK calls. Add another narrow, reviewed wrapper method with contract and failure tests when a new domain requires durable financial mutation.

## Error contract

| Code | Typical HTTP status | Caller behavior |
| --- | ---: | --- |
| `INVALID_INPUT` | 400 | Correct the input; do not mutate a previously bound operation |
| `FORBIDDEN` | 403 | Fix authenticated permissions or resource mapping |
| `PAYLOAD_CONFLICT` | 409 | Investigate reused identity or changed immutable terms |
| `BUSY` | 409 or 503 | Back off; reuse the same operation identity |
| `REVIEW_REQUIRED` | 409 | Investigate remote outcome before any replacement mutation |
| `LEASE_LOST` | 409 | Current worker must stop; another owner may have recovered |
| `INVALID_WEBHOOK` | 400 | Inspect signature/scope/version/body contract |
| `BODY_TOO_LARGE` | 413 | Review ingress limits and legitimate event size |
| `UPSTREAM_FAILED` | 502 | Treat outcome as potentially ambiguous; preserve the operation identity |
| `TEMPORARILY_UNAVAILABLE` | 503 | Infrastructure/unknown failure; response contains no internal details |

Errors intentionally expose stable codes rather than raw Stripe or SQL messages. Configure separate restricted telemetry for request IDs and diagnosis. An optional `observer` receives safe operation, job, and worker events. It is a hook for your exporter; it does not map every issuer decline to customer-facing instructions. A direct payment-confirmation product needs a carefully reviewed, customer-safe error mapping.

## Webhooks

`WebhookReceiver` requires one trusted account scope, 1 to 3 signing secrets, and an explicit event-type list. It accepts raw buffers up to the configured limit, verifies using the official SDK, and checks the exact pinned API version. Register snapshot events and keep server clocks synchronized. Its account binding comes from endpoint configuration; the platform account's identity is not independently discovered from the API key.

Platform events and connected-account events should use deliberately configured routes/receivers. Do not derive an authorized account from an unsigned header. This implementation rejects organization `context` and thin-event shapes. For a multi-account shared route, add a verified account resolver and allowlist before generalizing the receiver.

Express requires `express.raw({ type: 'application/json', limit, inflate: false })` before JSON parsing. Next.js uses the Node runtime and reads bounded raw bytes. Upstream hosting platforms must enforce body-size and request-duration limits too: a buffer limit does not stop a slow sender from occupying a connection indefinitely.

## Jobs and local effects

`WebhookWorker.runOnce()` returns `idle`, `done`, or `failed`. Run it from a long-lived worker or a scheduler that awaits completion; do not start unawaited work in a serverless request and expect it to survive the HTTP response.

The handler receives `(event, tx)`. Use only `tx` for local writes that need to commit with job completion. `effectOnce(tx, scope, key, work)` must be called inside that transaction. It is not an independently atomic helper if called with a pool outside a transaction.

`PostgresJobs.enqueue('outbox', ...)` can use the same `tx`. Reusing an outbox ID with different type/payload is rejected. `dispatchOutboxOnce` passes a stable key to the delivery function. The remote recipient's deduplication and retention must cover the complete retry/replay horizon.

Failed jobs back off with jitter up to five minutes and reach dead state after eight attempts by default. A crash on the last claim is also eventually marked dead. `replayDead` is an internal privileged operation with actor/reason audit. It resets attempts but preserves the job identity and business-effect guards.

## Reconciliation and projections

`refreshProjection` serializes a read-and-update for one resource. Supply a bounded current-state retrieval and persist a minimal non-secret projection. Its lock spans the retrieval. It provides neither global event ordering nor accounting history.

`importBalanceTransactions` scans a fixed creation window, iterates all SDK pages and upserts by scoped transaction ID. Repeated imports refresh availability/status. Schedule overlapping scans and refresh older pending items explicitly. It has no built-in checkpoint scheduler, period close, anomaly remediation or account-wide rate limiter.

`reconcile` compares IDs, currencies and `bigint` net amounts. It rejects duplicate IDs within an input set and reports missing, unexpected and mismatched rows. Supply one known account scope per comparison; identical transaction IDs from separate datasets must not be mixed without a scope-qualified key.

## Implemented versus application-specific

| Area | Delivered | Still required for a real product |
| --- | --- | --- |
| Reliability | Durable operations, inbox, leases, fences, effects and outbox | Retention, restore reconciliation, production infrastructure |
| Tenancy | Explicit scopes and authorization hook | Identity provider, membership/resource tables, commercial approvals |
| Checkout | Safe creation and sandbox one-time fulfillment example | Inventory, shipping, tax, fraud and commercial policy |
| Billing | Wrappers, current-state projections, recovery intents | Complete entitlement state machine, customer messaging and quote workflow |
| Refunds | Durable create | Approval limits, Dashboard coordination, final-status tracking and journal postings |
| Disputes | Detailed operational guide | Evidence storage, submission workflow, deadlines and risk integration |
| Connect | Request scope and account-matched snapshot ingestion | Accounts v2, capabilities, transfer/payout controls, reserves and liability policy |
| Finance | Balance import and exact comparisons | Double-entry accounting, bank matching, FX, revenue recognition |
| Security | Narrow inputs, signatures, no raw errors, bounded bodies | Deployment hardening, secret vault, rate limit, CSRF, audits and access review |

No measured production throughput, formal verification, independent penetration test, PCI certification, or universal security guarantee is claimed. The source and tests are provided so these boundaries can be reviewed rather than hidden.

## Package exports

| Import | Contents |
| --- | --- |
| `@safestripe/core` | Payment facade, stores, workers, helpers, and public types |
| `@safestripe/core/express` | `expressWebhook` |
| `@safestripe/core/next` | `nextWebhook` and `boundedBody` |
| `@safestripe/core/migrations` | `migrate` and `MigrationOptions` |

The `safestripe` command exposes `migrate` and `--help`. It reads `DATABASE_URL` from the environment. It does not load `.env` automatically or run during package installation.

## Configuration defaults

| Component | Option | Default | Accepted range or contract |
| --- | --- | --- | --- |
| `PostgresOperations` | `leaseSeconds` | 120 | 30 to 3,600 |
| `PostgresOperations` | `retryWindowSeconds` | 82,800 | 1 to 82,800; unresolved operations then need review |
| `PostgresJobs` | `leaseSeconds` | 120 | 1 to 3,600 |
| `PostgresJobs` | `maxAttempts` | 8 | 1 to 100 |
| `ConcurrencyGate` | concurrency | 8 | 1 to 1,000 |
| `ConcurrencyGate` | maxQueue | 32 | 0 to 10,000 |
| `ConcurrencyGate` | maxWaitMs | 5,000 | 1 to 60,000 |
| `WebhookReceiver` | `maxBytes` | 1,048,576 | 1,024 to 10,485,760 |
| `WebhookReceiver` | `toleranceSeconds` | 300 | 1 to 300 |
| `WebhookReceiver` | `signingSecrets` | Required | One to three endpoint secrets |
| `WebhookReceiver` | `eventTypes` | Required | Explicit, nonempty event allowlist |
| `runWorkerLoop` | concurrency | 1 | 1 to 64 |
| `runWorkerLoop` | pollIntervalMs | 500 | 10 to 60,000, with jitter |
| `runWorkerLoop` | errorIntervalMs | 1,000 | 10 to 60,000, with jitter |
| `migrate` | lockTimeoutMs | 10,000 | 1 to 300,000 |
| `migrate` | statementTimeoutMs | 60,000 | 1 to 3,600,000 |

`ConcurrencyGate.status` returns current active and waiting counts. `SafeStripeOptions.gate` accepts any `ExecutionGate` implementing `run<T>(task: () => Promise<T>): Promise<T>`. A replacement must hold capacity until the returned promise settles, release it on both success and failure, and bound its queue and waiting time.

`runWorkerLoop` requires an `AbortSignal`. It stops starting calls after abort and waits for calls already in progress. It does not forcibly interrupt a Stripe request or database transaction. The host process must enforce a shutdown deadline and arrange recovery if it is killed.

## Diagnostic events

Set `observer` on `SafeStripeOptions`, the fourth `WebhookWorker` argument, the fourth `dispatchOutboxOnce` argument, or `WorkerLoopOptions`. Events are immutable and have `category`, `action`, `outcome`, and `durationMs`. Job events include `attempt`. Failure events may include a stable code, a recognized Stripe error type, and a validated Stripe request ID.

Observers can return a promise, but the library does not await delivery. Rejected observer promises are contained. Use this for operational telemetry, not a mandatory audit write or another business effect. Wrapped durable mutations emit operation events; previews, portal sessions, webhook admission, raw SDK calls, and reconciliation do not currently emit those events.

## Migration behavior

`migrate(db, options?)` returns the filenames applied during the call. It holds a transaction-scoped advisory lock, verifies recorded checksums, applies pending SQL, and commits its history atomically. An unknown applied migration also blocks an older package from silently migrating a newer schema. The default limits bound lock waiting and each statement. Schema files resolve relative to the installed module, so migration works outside the source checkout.
