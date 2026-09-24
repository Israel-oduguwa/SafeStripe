# Contributing

Start by reading the [architecture guide](docs/02-distributed-architecture.md) and [library reference](docs/09-library-reference.md). Financial changes need a failure case as well as a success case.

## Local checks

```sh
npm ci
npm run release:check
```

Use a disposable PostgreSQL database for the database suite. `TEST_DATABASE_URL` opts into tests that truncate SafeStripe tables. Run those tests before changing claims, leases, transactions, indexes, or recovery behavior.

Keep migrations append-only. Add another numbered SQL file instead of editing an applied migration. Run migrations through the installed package as well as the source checkout.

## Changes to payment behavior

Describe the business operation, account scope, permission checks, immutable inputs, retry behavior, and outcome after a crash. Include a regression test for a meaningful failure: a duplicate request, a stale worker, a connection loss, or a reordered event. Use the official SDK types and link the Stripe behavior you rely on.

Changes to public methods, error codes, exported types, or database state are API changes. Record them in the changelog. During 0.x development, a minor version may contain a breaking change; patch versions should preserve the documented contract.

Never add real payment records or keys to fixtures. Report security issues privately using the repository's configured security reporting channel. Contributions are accepted under the repository's MIT license; retain third-party notices where applicable.
