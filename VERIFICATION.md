# Verification record

Reviewed 24 September 2026. Package: `@safestripe/core` 0.2.0 release candidate. Local runtime: Node.js 22.19.0 on macOS. Stripe SDK: 22.6.2. Snapshot API contract: `2026-08-26.dahlia`.

## Local results

| Check | Observed result |
| --- | --- |
| Full release pipeline | Passed: formatting, strict types, tests, library build, Next.js build, documentation, license generation and clean package installation |
| Automated suite at that run | 75 tests: 72 passed, zero failures, three expected skips |
| Local starter fulfillment test added afterward | Passed separately: authentication, durable binding, commercial-term mismatch rejection, duplicate events, single receipt intent and changed-flow conflict |
| SQLite and embedded PostgreSQL conformance | Passed: competing claims, fingerprints, recovery cutoff, expired leases, transaction rollback, effects/outbox, signed admission, replay and concurrent record updates |
| SQLite restart | Stored billing data survived close/reopen |
| Account discovery | Mocked SDK lookup resolved scope without an explicit account ID; real account credentials were not used |
| Custom Checkout contract | Uses custom Sessions and the server-configured return URL; no browser-selected payment-method override |
| Next.js example | Production build passed, including React form and checkout/order/webhook routes |
| Clean package consumer | Installed the archive; core, framework, migration, SQLite and React exports loaded; strict server-side consumer types passed |
| Automatic dependencies | Stripe resolved after installation; MongoDB and Firestore SDKs were absent unless separately installed |
| Dependency audit | npm reported zero known vulnerabilities in the checked runtime dependency set |
| License notices | Generated notices for 36 installed runtime dependencies/peers |
| Documentation | 21 guides; 21 typed snippets plus a JavaScript tutorial checked; links, anchors, CSP and script syntax passed |
| Documentation interactions | DOM checks passed for synchronized tabs, keyboard switching, copy, syntax-color markup, search and navigation |

The three local suite skips are the test requiring independent PostgreSQL connections and the MongoDB/Firestore service suites. Local testing does not install Docker, a MongoDB server or a Firebase emulator.

## Remote checks

The original 0.1 commit passed GitHub CI on Node.js 22 and 24 with PostgreSQL 17. The current 0.2 workflow adds a MongoDB 8 replica set and the Firestore emulator on GitHub's isolated runners. Results for the updated commit must be confirmed before treating those adapters as integration-verified. The emulator does not enforce every production index/IAM behavior; deploy and validate the supplied Firestore indexes in your project.

## What has not been established

No real Stripe credentials were supplied or used. Actual sandbox checkout, issuer authentication, asynchronous payment methods, Dashboard workflows and live payments have not been exercised against an account. The SDK HTTP fixture verifies request behavior, not the full Stripe service.

There is no enterprise throughput benchmark, failover certification, independent security audit or compliance certification. Transaction conformance proves specific invariants under tested conditions. It does not establish capacity across all database tiers or hosting platforms.

The documentation's generated structure and DOM interactions were checked. Browser policy previously prevented a rendered review of the local HTML; a screenshot-based visual review is not included. The React payment component compiles and imports, but its real Stripe-hosted fields still need sandbox browser and accessibility testing.

The sample authorization policy is local-only and refuses production. A deployed application needs real authentication, tenant/resource policies, approved commercial terms, monitored workers, a deduplicating outbox recipient, retention/backups and reconciliation. Read [deployment](docs/14-deployment-and-publishing.md).

No npm publication or financial transaction was performed. The repository is hosted on GitHub; registry publication is a separate release step.

## Reproduce

```bash
npm ci --ignore-scripts
npm run release:check
npm run demo
```

Use a disposable database for integration tests: `TEST_DATABASE_URL` runs the PostgreSQL suite; these tests truncate SafeStripe tables. `PACKAGE_DATABASE_URL` enables migration checks from the installed archive. `MONGODB_TEST_URI` must point to an isolated replica set; tests create and remove a temporary database. `FIRESTORE_EMULATOR_HOST` enables the emulator suite; it creates and removes temporary collections.

For the first real sandbox payment, use the separate [maintainer test guide](maintainer/README.md) or the [consumer quickstart](docs/03-quickstart.md). Keep keys in the local environment, not chat or source code.
