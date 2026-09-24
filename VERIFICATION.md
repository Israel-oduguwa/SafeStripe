# Verification record

Reviewed 24 September 2026. Package: `@safestripe/core` 0.2.0. Local runtime: Node.js 22.19.0 on macOS. Stripe SDK: 22.6.2. Snapshot API contract: `2026-08-26.dahlia`.

## Local results

| Check | Observed result |
| --- | --- |
| Full release pipeline | Passed: formatting, strict types, tests, library build, Next.js build, documentation, license generation and clean package installation |
| Automated suite at that run | 76 tests: 73 passed, zero failures, three expected skips |
| Local starter fulfillment | Passed in the suite: authentication, durable binding, commercial-term mismatch rejection, duplicate events, single receipt intent and changed-flow conflict |
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

[GitHub Actions run 35990082440](https://github.com/Israel-oduguwa/SafeStripe/actions/runs/35990082440) passed all three jobs for commit `e91329c`:

| CI job | Result |
| --- | --- |
| Node.js 22 release checks | Passed, including Next.js build, package installation and audit |
| Node.js 24 release checks | Passed, including Next.js build, package installation and audit |
| Offline suite including local starter | 76 tests: 73 passed, zero failures, three expected skips |
| Real PostgreSQL 17 suite | 76 tests: 74 passed, zero failures, two skips for document services checked in their own job |
| Four-adapter conformance on a runner with MongoDB 8 and Firestore emulator | All 35 passed, zero failures or skips |

The emulator does not enforce every production index/IAM behavior; deploy and validate the supplied Firestore indexes in your project. Subsequent packaging and UI changes use the same CI workflow; consult the repository's latest run for the result on each commit.

The separate Express/Firestore demo passed 20 consumer tests on Node.js 22 and 24 in [run 36004359058](https://github.com/Israel-oduguwa/Safestripe-test-demo-website/actions/runs/36004359058). It installs the release archive and tests signatures, duplicate events, checkout replays, order authorization and payment-term checks. Its automated fixtures use SQLite and simulated Stripe responses; the running demo uses Firestore. Real Stripe and Firebase configuration remains necessary for the browser payment test.

## What has not been established

No real Stripe credentials were supplied or used. Actual sandbox checkout, issuer authentication, asynchronous payment methods, Dashboard workflows and live payments have not been exercised against an account. The SDK HTTP fixture verifies request behavior, not the full Stripe service.

There is no enterprise throughput benchmark, failover certification, independent security audit or compliance certification. Transaction conformance proves specific invariants under tested conditions. It does not establish capacity across all database tiers or hosting platforms.

The documentation's generated structure and DOM interactions were checked; a rendered visual review of the handbook is not included. The React payment component compiles and imports, but its real Stripe-hosted fields still need sandbox browser and accessibility testing.

The sample authorization policy is local-only and refuses production. A deployed application needs real authentication, tenant/resource policies, approved commercial terms, monitored workers, a deduplicating outbox recipient, retention/backups and reconciliation. Read [deployment](docs/14-deployment-and-publishing.md).

These checks did not perform a financial transaction. Registry publication is a separate release step.

## Reproduce

```bash
npm ci --ignore-scripts
npm run release:check
npm run demo
```

Use a disposable database for integration tests: `TEST_DATABASE_URL` runs the PostgreSQL suite; these tests truncate SafeStripe tables. `PACKAGE_DATABASE_URL` enables migration checks from the installed archive. `MONGODB_TEST_URI` must point to an isolated replica set; tests create and remove a temporary database. `FIRESTORE_EMULATOR_HOST` enables the emulator suite; it creates and removes temporary collections.

For the first real sandbox payment, use the separate [maintainer test guide](maintainer/README.md) or the [consumer quickstart](docs/03-quickstart.md). Keep keys in the local environment, not chat or source code.
