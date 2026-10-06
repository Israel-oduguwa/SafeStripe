# Verification record

## Hosted sandbox and release audit — 6 October 2026

The public demo now runs at [safestripe-demo.vercel.app](https://safestripe-demo.vercel.app/) with Express on Render and Firestore. Its installed dependency is the packed 0.3.0 preview with Stripe SDK 22.6.2 and snapshot API `2026-08-26.dahlia`. The unscoped npm package was still unavailable at this review; the published scoped package is 0.2.0. Browser results from this demo do not establish installation from the future unscoped npm release.

The real Stripe sandbox walkthrough completed hosted $5 one-time and $10 recurring Checkout with signed webhook processing and saved Firestore receipts. A $1 refund succeeded; replay retained the refund identity and an excessive refund was rejected. The customer portal opened, saved test payment methods were visible, and a paid subscription upgrade was previewed and applied. Setup-mode Checkout completed without payment. Invoice, credit, quote, schedule, trial, seat, pricing and usage records were exercised with different completion boundaries.

Important remaining limits: an incomplete subscription is not a paid tiered-pricing test; accepting usage is not verifying its billed total; accepting a clock advance is not verifying every subsequent renewal. Payment Link completion was observed in Stripe's hosted page but did not prove local order fulfillment. Connect needs an eligible configured account, Identity remains disabled publicly, and no activated-tax calculation was completed. Custom Checkout returned `UPSTREAM_FAILED`; the corresponding private Stripe request log has not yet been inspected. See [issue 18](https://github.com/Israel-oduguwa/SafeStripe/issues/18).

The main library checks failed on Node 24 in [run 37377394563](https://github.com/Israel-oduguwa/SafeStripe/actions/runs/37377394563) during twenty-process PostgreSQL contention. The finite test worker called `runOnce` without the production loop's infrastructure retry behavior. The revised harness runs that loop until the parent observes all expected completed jobs, then drains the workers. It retains one committed fulfillment, effect and outbox intent as required assertions. Child failures expose only a bounded error code, not raw database details. The regression for recovery after a temporary claim failure and all six local SQLite process cases passed; PostgreSQL confirmation belongs to the revised commit's CI, not these local results. [Issue 19](https://github.com/Israel-oduguwa/SafeStripe/issues/19) tracks this correction.

The demo adds seven browser-DOM regressions for saved-session reload, network failure and retry, delayed restoration, interrupted setup and expiry during connection checks. These use controlled HTTP responses, not actual Stripe credentials. Its local suite passed **85 tests, zero failed and one Firestore-emulator skip**. The session retains its existing one-hour absolute expiry and HttpOnly/Secure cookie. No test key is stored in browser storage.

The dedicated Stripe service suite, private custom Checkout diagnosis, independent security/usability review, shared-database capacity report and signed/provenance-backed unscoped publication remain release gates. Read the [current readiness assessment](docs/28-release-readiness.md) before recommending production use. Earlier dated statements about unavailable real credentials describe those earlier runs and are retained below.

## Billing Meter identifier regression — 5 October 2026

The identifier validator rejected Stripe's documented `mtr_test_…` Meter IDs, so valid usage requests failed before reaching Stripe. The revised validator supports test/live Meter environment prefixes, retains legacy fixture compatibility and leaves other resource formats unchanged. A regression also sends the documented Meter ID through the actual Stripe SDK against a controlled local HTTP server. Identifier cases reject missing suffixes, unsupported environment segments, paths, query strings, control characters and excessive length.

The local check completed on Node.js 22.20.0 with **107 tests passed, zero failed and three provider-dependent skips**, followed by a successful TypeScript build. The corrected demo fixture reproduced its interrupted-setup error before the fix; genuine hosted recovery and CI must be recorded separately. These tests do not establish real Stripe payment behavior.

## Stabilization checks — 3 October 2026

The stabilization branch adds a bounded reliability contract, eight retrospective ADRs, architecture and crash-boundary diagrams, a technical article, an optional sandbox service suite and release/security workflows. These documents describe mechanisms and limits; they do not certify production readiness.

- The existing local suite passed: 105 tests, zero failures, three service-dependent skips, on Node 22.20.0.
- Real local child-process failure tests passed six cases, including SIGKILL before commit and after a simulated recipient commits, SIGTERM, duplicate delivery and stale ownership. Seven PostgreSQL cases require the CI database and are not counted as local passes.
- Three measured SQLite benchmark runs each processed 1,000 event identities after 10,000 delivery attempts. All ended with 1,000 effects and outbox intents, no duplicate effects and no worker errors. See the [method and raw report](https://github.com/Israel-oduguwa/SafeStripe/tree/main/benchmarks). This is not an enterprise capacity measurement.
- Backend-only clean installation passed without PostgreSQL, React or Stripe's browser libraries. Optional feature imports are checked after explicitly installing their peers. Stripe's server SDK remains included.
- Strict types, the Next.js build, 28 documentation guides, 40 typed snippets and documentation interaction checks passed. Runtime license notices now cover 12 included dependencies.
- The demo's 48 local tests passed, including six hosted-session checks. Its additional Firestore emulator test and real deployed walkthrough are separate checks.

No real Stripe or Firebase credentials were present in the demo environment. The optional Stripe service test has not been run against an account. Render deployment, actual signed webhook delivery, npm trusted-publisher setup, a maintainer-signed release and independent usability/security review remain open release gates. Historical results below describe earlier revisions.

The stabilization commit `bbe82e2` passed [GitHub CI run 37124055220](https://github.com/Israel-oduguwa/SafeStripe/actions/runs/37124055220): Node 22/24 release checks, real PostgreSQL, and document-adapter conformance. All 13 process-failure cases passed with PostgreSQL enabled, including twenty competing child processes. [Security run 37124055224](https://github.com/Israel-oduguwa/SafeStripe/actions/runs/37124055224) passed CodeQL and dependency review after the repository dependency graph was enabled. Secret scanning and push protection were enabled; no open CodeQL alerts were returned at this check. These are automated checks, not an independent security audit.

## Earlier feature baseline

Reviewed 2 October 2026. Package: `safestripe` 0.3.0 preview. Local runtime: Node.js 22.19.0 on macOS. Stripe SDK: 22.6.2. Snapshot API contract: `2026-08-26.dahlia`.

The local package checks passed for the expanded billing scenario surface. The clean consumer check installed the 201-file archive, including the new scenario and metrics modules. The previously scoped 0.2.0 release is already published; the unscoped 0.3.0 release remains a preview awaiting publication.

## Local results

| Check                                      | Observed result                                                                                                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full release pipeline                      | Passed: formatting, strict types, tests, library build, Next.js build, documentation, license generation and clean package installation                               |
| Automated suite at that run                | 108 tests: 105 passed, zero failures, three expected skips                                                                                                            |
| Local starter fulfillment                  | Passed in the suite: authentication, durable binding, commercial-term mismatch rejection, duplicate events, single receipt intent and changed-flow conflict           |
| SQLite and embedded PostgreSQL conformance | Passed: competing claims, fingerprints, recovery cutoff, expired leases, transaction rollback, effects/outbox, signed admission, replay and concurrent record updates |
| SQLite restart                             | Stored billing data survived close/reopen                                                                                                                             |
| Account discovery                          | Mocked SDK lookup resolved scope without an explicit account ID; real account credentials were not used                                                               |
| Custom Checkout contract                   | Uses custom Sessions and the server-configured return URL; no browser-selected payment-method override                                                                |
| Next.js example                            | Production build passed, including React form and checkout/order/webhook routes                                                                                       |
| Clean package consumer                     | Installed the archive; core, framework, migration, SQLite and React exports loaded; strict server-side consumer types passed                                          |
| Automatic dependencies                     | Stripe resolved after installation; MongoDB and Firestore SDKs were absent unless separately installed                                                                |
| Dependency audit                           | npm reported zero known vulnerabilities in the checked runtime dependency set                                                                                         |
| License notices                            | Generated notices for 36 installed runtime dependencies/peers                                                                                                         |
| Documentation                              | 24 guides; 40 typed snippets plus a JavaScript tutorial checked; links, anchors, CSP and script syntax passed                                                         |
| Official website                           | Static build passed; local links, framework tabs, keyboard switching and copy checked; desktop and mobile layouts reviewed                                            |
| Documentation interactions                 | DOM checks passed for synchronized tabs, keyboard switching, copy, syntax-color markup, search and navigation                                                         |

The three local suite skips are the test requiring independent PostgreSQL connections and the MongoDB/Firestore service suites. Local testing does not install Docker, a MongoDB server or a Firebase emulator.

## Added scenario coverage

The new SDK HTTP fixture exercises 25 write scenarios using the real pinned Stripe SDK against a local mock server. It checks paths, request bodies, idempotency keys and one-mutation replay. Separate checks cover denied authorization, changed inputs, sandbox clock restrictions, missing recipient capability, paid-invoice credit rejection and unconfigured tax.

Revenue tests cover movement reconciliation, customer cohorts, zero denominators, interval normalization, rounding, duplicate identities and numeric overflow. These tests do not prove Stripe account eligibility or actual service behavior.

The separate demo now installs the packed 0.3.0 archive. All 42 local workflow/HTTP tests passed after correcting metered-item result serialization. It uses 51 selectable panels, including four setup guides and one local calculator. Browser checks confirmed the calculator sample, invalid-input feedback and account-service guide dialog.

## Remote checks (previous release baseline)

The previous 0.2.0 preparation passed all jobs in [run 36869730724](https://github.com/Israel-oduguwa/SafeStripe/actions/runs/36869730724), including Node.js 22/24 release checks and the document-adapter job. The expanded demo passed its Node.js 22/24 jobs in [run 36869738049](https://github.com/Israel-oduguwa/Safestripe-test-demo-website/actions/runs/36869738049). The public static site deployed through [run 36869985522](https://github.com/Israel-oduguwa/SafeStripe/actions/runs/36869985522).

[GitHub Actions run 35990082440](https://github.com/Israel-oduguwa/SafeStripe/actions/runs/35990082440) passed all three jobs for commit `e91329c`:

| CI job                                                                     | Result                                                                                       |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Node.js 22 release checks                                                  | Passed, including Next.js build, package installation and audit                              |
| Node.js 24 release checks                                                  | Passed, including Next.js build, package installation and audit                              |
| Offline suite including local starter                                      | 76 tests: 73 passed, zero failures, three expected skips                                     |
| Real PostgreSQL 17 suite                                                   | 76 tests: 74 passed, zero failures, two skips for document services checked in their own job |
| Four-adapter conformance on a runner with MongoDB 8 and Firestore emulator | All 35 passed, zero failures or skips                                                        |

The emulator does not enforce every production index/IAM behavior; deploy and validate the supplied Firestore indexes in your project. Subsequent packaging and UI changes use the same CI workflow; consult the repository's latest run for the result on each commit.

The separate Express/Firestore demo previously passed 20 consumer tests on Node.js 22 and 24 in [run 36004359058](https://github.com/Israel-oduguwa/Safestripe-test-demo-website/actions/runs/36004359058). That revision installed the published scoped npm release. Its then-expanded local suite passed 33 checks on 1 October, covering signatures, duplicate events, checkout replays, ownership, invoice/subscription/refund workflows and effect/outbox behavior. Its automated fixtures use SQLite and simulated Stripe responses; the running demo uses Firestore. Real Stripe and Firebase configuration remains necessary for the browser payment test.

## What has not been established

No real Stripe credentials were supplied or used. Actual sandbox checkout, issuer authentication, asynchronous payment methods, Dashboard workflows and live payments have not been exercised against an account. The SDK HTTP fixture verifies request behavior, not the full Stripe service.

There is no enterprise throughput benchmark, failover certification, independent security audit or compliance certification. Transaction conformance proves specific invariants under tested conditions. It does not establish capacity across all database tiers or hosting platforms.

The documentation's structure, DOM interactions and published desktop rendering were checked. The live Firebase installation tab was reviewed in the browser. The React payment component compiles and imports, but its real Stripe-hosted fields still need sandbox browser and accessibility testing.

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
