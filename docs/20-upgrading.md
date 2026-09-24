# Upgrade without losing history

SafeStripe 0.2 adds portable storage and a setup factory. The original `SafeStripe`, `PostgresOperations`, `PostgresJobs`, SQL `effectOnce` and SQL projection helpers remain available for existing PostgreSQL integrations.

## Existing 0.1 PostgreSQL applications

Continue constructing the original SQL classes against their existing tables. Your stored operations, jobs, effects and audit history remain the source of truth. Applying migration `002_portable_storage.sql` creates a separate `sf_records` table; it does **not** copy old operation history into the new portable format.

Do not replace `new PostgresOperations(db)` with `postgresStorage({ db })` and assume the old records are reused. A fresh operation store can forget that an action already happened, especially after Stripe's idempotency retention window. There is no automatic cross-format migration in this release.

The original SQL guide is retained in [SQL integration details](12-integration.md). The legacy Express sample is available through `npm run dev:express:legacy`; its worker uses `npm run worker:legacy`. The main Express and Next.js quickstarts now use the portable adapter and a separate learning workflow.

## New applications

Use `createSafeStripe` with one of the four portable adapters. All replicas serving one Stripe scope must point to the same durable billing store. Keep the account, mode and connected-account scope stable when changing credentials for the same account.

## Moving between databases or formats

A safe migration is a project-specific data migration, not a connection-string edit. Inventory pending and ambiguous operations, unfinished jobs, effect keys, Session bindings, outbox deliveries and audit records. Freeze or route new writes, drain workers, take a recoverable snapshot and transform the full history with checksums and count reconciliation. Preserve operation IDs, fingerprints, idempotency keys, resource IDs and scope identities exactly.

Verify representative successful, pending, retry, review and dead records after import. Test that a completed old purchase replays without issuing a new create. Establish a rollback procedure that cannot leave two stores accepting independent writes. Reconcile remote Stripe resources before reopening traffic.

SQLite-to-hosted migration is not required for a disposable sandbox exercise if you deliberately use a new sandbox and new order identities. Do not apply that shortcut to live payments or reuse forgotten business actions.

## Compatibility notes

The current SDK is pinned to Stripe `22.6.2`, with snapshot API version `2026-08-26.dahlia`. Node.js must be at least 22.19. The package is ESM. The browser component is exported separately as `@safestripe/core/react` and uses React 18 or 19.

MongoDB driver 7 and Firestore server SDK 9 are optional peers. Only install the driver you use. They are compiled and exercised by the adapter checks described in [the verification record](../VERIFICATION.md); a version range alone is not proof that every provider configuration has been tested.
