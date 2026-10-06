# Verification record

## Final recovery, protected sandbox and security sweep — 6 October 2026

[Recovery PR 31](https://github.com/Israel-oduguwa/SafeStripe/pull/31) merged as `879b085`. Its [main checks](https://github.com/Israel-oduguwa/SafeStripe/actions/runs/37527316763) passed Node 22/24, real PostgreSQL and document adapters. The process suite passed all 14 cases with PostgreSQL enabled, including terminating the fixture's actual in-flight database connection and recovering one fulfillment, effect and outbox intent. Adapter conformance now checks a shared-capacity predicate with writers updating different records; real PostgreSQL and MongoDB deliberately overlap their initial snapshot reads. Firestore and SQLite may serialize those reads. These results establish the tested invariants, not enterprise capacity.

The [first protected Stripe run](https://github.com/Israel-oduguwa/SafeStripe/actions/runs/37527335196) read and verified the owner-configured account on clean revision `879b085`. Customer response loss and replay passed, with one remote customer. Checkout creation/replay then failed with `StripePermissionError`. The [redacted report](docs/evidence/stripe-protected-first-run-2026-10-06.json) remains a failed run; fixture cleanup completed without a reported cleanup error.

[PR 34](https://github.com/Israel-oduguwa/SafeStripe/pull/34) added an explicit sandbox secret-key option after its Node 22/24, provider and security checks passed. At 21:04 UTC, the [second protected run](https://github.com/Israel-oduguwa/SafeStripe/actions/runs/37531112287) passed all six service checks on clean revision `5f06e28` with the maintainer-selected test secret key. It verified the remote account, one customer after response loss and replay, hosted and Elements Checkout replay, one full refund, subscription line items and the expected portal customer. No cleanup failure was reported. The [retained report](docs/evidence/stripe-protected-secret-2026-10-06.json) contains no key, account ID, payment URL or customer payload. Browser payment and actual public webhook delivery are separate observations; this service run does not cover live payments or every billing lifecycle. A future release must repeat these checks on its exact tag commit.

That same revision passed [main database and Node checks](https://github.com/Israel-oduguwa/SafeStripe/actions/runs/37531107240) and [security analysis](https://github.com/Israel-oduguwa/SafeStripe/actions/runs/37531107235). The automated evidence checker accepted those three actual workflow reports together. This validates the evidence gate for `5f06e28`; it does not provide a signed tag, package provenance or independent audit.

A fresh full audit found the newly indexed high-severity [sharp/librsvg advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) in the Next.js example's development graph. [Dependabot PR 32](https://github.com/Israel-oduguwa/SafeStripe/pull/32) upgraded sharp to 0.35.5 after provider, Node and security checks passed. The merged revision `792df30` passed [main checks](https://github.com/Israel-oduguwa/SafeStripe/actions/runs/37528103523) and [security analysis](https://github.com/Israel-oduguwa/SafeStripe/actions/runs/37528103500). The first follow-up audit request timed out and was not accepted as clean; the repeated full audit returned zero known vulnerabilities. Its [snapshot](docs/evidence/dependency-audit-sharp-2026-10-06.json) identifies the patched lockfile. CI and the publishing workflow now audit the full installed graph, including examples and release tools. The published core dependency graph does not contain sharp.

The demo's registry transition merged as `656f580`; [main CI](https://github.com/Israel-oduguwa/Safestripe-test-demo-website/actions/runs/37526395441) passed all four jobs. Vercel and Render reported that revision deployed, and its proxied API and Firestore health check succeeded. [Website publication](https://github.com/Israel-oduguwa/SafeStripe/actions/runs/37527341130) succeeded from `879b085`; the live install copy button and Next.js tab worked. The release remains an evaluation preview.

## Public npm installation — 6 October 2026

The unscoped `safestripe@0.3.0` release became public at 20:05 UTC. Its registry integrity matches the reviewed archive from clean revision `91bf369`; SHA-256 is `82cc0d119bf0874dde276488bef2b1b6495ef84f53b911247f6664358a77d38b`. At 20:15 UTC, a new temporary consumer installed that exact version with ordinary `npm install`, without suppressing lifecycle scripts or using a sibling checkout. Core, Express, Next.js, metrics and migration exports, strict consumer types, installed CLI help and a SQLite transaction round trip passed. Stripe SDK 22.6.2 installed automatically. PostgreSQL, MongoDB, Firestore, Express and React were absent from the core installation; their exports loaded after explicitly installing the chosen peers. The [sanitized report](docs/evidence/npm-registry-2026-10-06.json) records versions and integrity.

This was a local first publication, with no CI provenance or GitHub-verified signed release tag. Peer import checks do not establish database connectivity. Earlier observations that npm authentication failed or the package was unavailable remain historical results, not the current registry state. Account-verified Stripe CI has since passed as recorded above. Signed and provenance-backed publication, independent review and target-infrastructure validation remain necessary before a broad production recommendation.

## Public Elements payment and loading recovery — 6 October 2026

The public demo completed a $5.00 synthetic-card Elements payment at 14:42 UTC. Its initial form stalled on loading; reopening the same checkout recovered it without another Session. The browser then showed submitted, a paid order and a signed Firestore receipt with matching 500 USD cents and paid time. The [sanitized observation](docs/evidence/stripe-public-elements-2026-10-06.json) records the deployed source and distinguishes this manual public test from protected release CI. No live money or real card was used. A second checkout rejected the insufficient-funds card and remained unpaid. Retrying that same checkout with the documented 3D Secure card opened the real test challenge; completing it produced a second matching signed Firestore receipt at 14:53 UTC. Delayed payment methods remain untested.

The component now waits for the Payment Element ready event before enabling confirmation or announcing readiness. A 30-second slow notice and an initialization/field-error notice offer a retry that remounts the provider with the same client secret. Callback failures do not disrupt initialization or confirmation. Six isolated React/DOM scenarios cover stalled initialization, late arrival, SDK/field errors, duplicate confirmation, decline/ambiguous results and consumer re-renders. After [library PR 27](https://github.com/Israel-oduguwa/SafeStripe/pull/27) and [demo PR 29](https://github.com/Israel-oduguwa/Safestripe-test-demo-website/pull/29) merged, the corrected public component completed another $5 test payment and signed Firestore receipt at 15:02 UTC. Its ready callback and enabled submit control were observed after the fields loaded. Reload restored the same active sandbox without re-entering keys. Main [library CI](https://github.com/Israel-oduguwa/SafeStripe/actions/runs/37483462407), [security analysis](https://github.com/Israel-oduguwa/SafeStripe/actions/runs/37483462034) and [demo CI](https://github.com/Israel-oduguwa/Safestripe-test-demo-website/actions/runs/37483525280) passed. No open CodeQL alerts were returned. The original stall’s root cause remains unproven; the forced slow/error cases are isolated DOM tests. npm authentication still returned E401 at this check.

## Real browser component payment and merged checks — 6 October 2026

A new high-severity Dependabot alert identified `source-map-js` 1.2.1 through the development Next.js/PostCSS graph. The lockfile now uses upstream patch 1.2.2 for [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q). The subsequent full dependency audit, including development tools, returned zero reported vulnerabilities. Its [retained snapshot](docs/evidence/dependency-audit-2026-10-06.json) identifies the patched lockfile fingerprint and records that it was measured before commit. This advisory snapshot is not an independent security review; main's alert closure requires merging the patch.

The actual SafeCheckout browser bundle completed a $5.00 fake-card payment in the temporary Stripe CLI sandbox. Stripe-hosted fields loaded, the component showed submitted, and a server-side Stripe read verified paid status, the expected test customer, 500 minor units and USD. The payment was refunded and its disposable customer/catalog fixtures were cleaned. The [redacted browser report](docs/evidence/stripe-browser-2026-10-06.json) records the library revision, frontend revision and bundle fingerprint. This local browser test did not receive a network webhook, write a Firestore receipt, exercise 3DS or establish public deployment behavior. Its unclaimed sandbox cannot satisfy the account-verified release gate.

[Stabilization PR 22](https://github.com/Israel-oduguwa/SafeStripe/pull/22) merged as `b4b4002`. Its [main database and Node checks](https://github.com/Israel-oduguwa/SafeStripe/actions/runs/37462037904) and [main security analysis](https://github.com/Israel-oduguwa/SafeStripe/actions/runs/37462038179) passed. No open CodeQL findings on main were returned after that analysis; the seven earlier findings were resolved by the code changes, not dismissed. The reproducible benchmark issue closed with the recorded report. [Independent security review](https://github.com/Israel-oduguwa/SafeStripe/issues/23), account-verified protected Stripe CI and signed/provenance-backed publication remain open.

## Retained service and PostgreSQL results — 6 October 2026

Revision `0bced69` passed [Node 22/24 and provider CI](https://github.com/Israel-oduguwa/SafeStripe/actions/runs/37448381176), [CodeQL and dependency review](https://github.com/Israel-oduguwa/SafeStripe/actions/runs/37448381208), and [the PostgreSQL benchmark matrix](https://github.com/Israel-oduguwa/SafeStripe/actions/runs/37448381177). Benchmark reports identify the tested pull-request merge revision and source-input fingerprint, not an assumed branch checkout. Nine measured repetitions each completed 1,000 jobs, effects and outbox intents after 10,000 admission attempts, with zero duplicate effects. Four- and eight-lane warm-ups each recovered three exhausted transactions; those failed attempts remain visible. The [report](benchmarks/README.md) includes all raw observations and the original failed matrix. This does not establish enterprise capacity.

The [redacted Stripe service report](docs/evidence/stripe-service-2026-10-06.json) retains six actual API checks on clean source revision `82e51e5`, with SDK 22.6.2 and API `2026-08-26.dahlia`. It identifies its unclaimed temporary sandbox and lack of remote account verification. It does not satisfy the protected account-verified release gate. Local release checks passed 121 tests with three provider-dependent skips; release-evidence rejection tests passed separately. The demo fix passed 90 local tests with one Firestore-emulator skip. Deployed browser verification and publication remain separate work.

## Elements Checkout and real service proof — 6 October 2026

A newly provisioned, temporary Stripe CLI sandbox reproduced the custom Checkout failure. Stripe rejected `ui_mode: custom` and required `elements`. The corrected library preserves its public `uiMode: custom` option and sends the supported parameter. A real API probe then returned an Elements Session with a client secret. The SDK regression rejects the obsolete parameter in a controlled HTTP fixture; this regression is distinct from the real probe.

The extended actual-SDK runner passed six checks: customer creation with deliberate response loss after remote success and one-customer replay; hosted Checkout replay; Elements Checkout and stable replay; a successful test PaymentIntent and one full refund; subscription price/replay; and portal creation. Fixtures were canceled, expired, archived or deleted. A portal configuration remains in the temporary sandbox. This was an unclaimed CLI sandbox with a seven-day lifetime: account details cannot be read remotely, so its provisioning response supplies the account association. It is not accepted as account-verified release evidence. Browser payment fields, 3DS, real network webhook delivery and live payments were not covered by this runner.

The current scan exposed seven high-severity findings in the local Express examples and documentation tooling. The examples now apply maintained request-rate middleware before authorization; the build and checks use an HTML parser for heading text and script extraction instead of incomplete tag filters. Dependabot security fixes and vulnerability alerts are now enabled. Closure still requires a new CodeQL analysis.

The release job now checks database CI, CodeQL and account-verified sandbox reports on the exact tagged commit. Tests reject evidence from another revision, skipped provider jobs, failed runs, dirty source and temporary unclaimed accounts. The `npm-release` and `stripe-sandbox` GitHub environments now require maintainer review and permit deployment only from main. No credentials have been uploaded to either environment yet; signed tags and npm trusted publishing still require the maintainer's account setup.

The PostgreSQL benchmark runs on GitHub-hosted infrastructure, keeping Docker off the local computer. It retains failures, records transaction callback retries and uses the production worker retry loop until the expected backlog finishes. The outside-review guide supplies onboarding and failure exercises; it does not claim an independent audit has occurred.

## Hosted sandbox and release audit — 6 October 2026

The public demo now runs at [safestripe-demo.vercel.app](https://safestripe-demo.vercel.app/) with Express on Render and Firestore. Its installed dependency is the packed 0.3.0 preview with Stripe SDK 22.6.2 and snapshot API `2026-08-26.dahlia`. The unscoped npm package was still unavailable at this review; the published scoped package is 0.2.0. Browser results from this demo do not establish installation from the future unscoped npm release.

The real Stripe sandbox walkthrough completed hosted $5 one-time and $10 recurring Checkout with signed webhook processing and saved Firestore receipts. A $1 refund succeeded; replay retained the refund identity and an excessive refund was rejected. The customer portal opened, saved test payment methods were visible, and a paid subscription upgrade was previewed and applied. Setup-mode Checkout completed without payment. Invoice, credit, quote, schedule, trial, seat, pricing and usage records were exercised with different completion boundaries.

Important remaining limits: an incomplete subscription is not a paid tiered-pricing test; accepting usage is not verifying its billed total; accepting a clock advance is not verifying every subsequent renewal. Payment Link completion was observed in Stripe's hosted page but did not prove local order fulfillment. Connect needs an eligible configured account, Identity remains disabled publicly, and no activated-tax calculation was completed. Custom Checkout returned `UPSTREAM_FAILED`; the corresponding private Stripe request log has not yet been inspected. See [issue 18](https://github.com/Israel-oduguwa/SafeStripe/issues/18).

The main library checks failed on Node 24 in [run 37377394563](https://github.com/Israel-oduguwa/SafeStripe/actions/runs/37377394563) during twenty-process PostgreSQL contention. The finite test worker called `runOnce` without the production loop's infrastructure retry behavior. The revised harness runs that loop until the parent observes all expected completed jobs, then drains the workers. It retains one committed fulfillment, effect and outbox intent as required assertions. Child failures expose only a bounded error code, not raw database details. The regression for recovery after a temporary claim failure and all six local SQLite process cases passed locally. Revision `a59ea98` then passed [CI run 37439904112](https://github.com/Israel-oduguwa/SafeStripe/actions/runs/37439904112), including Node 22/24 release checks, all thirteen process cases with PostgreSQL enabled, and MongoDB/Firestore conformance. [Security run 37439904122](https://github.com/Israel-oduguwa/SafeStripe/actions/runs/37439904122) passed CodeQL and dependency review. [Issue 19](https://github.com/Israel-oduguwa/SafeStripe/issues/19) tracks this correction.

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
