# Verification record

Reviewed: 24 September 2026. Package: `@safestripe/core` 0.1.0 release candidate. Local runtime: Node.js 22.19.0 on macOS x86_64. Stripe SDK: 22.6.2. API contract: `2026-08-26.dahlia`.

## Results

| Check | Result |
| --- | --- |
| Source formatting | Passed using pinned Prettier 3.9.9 |
| Strict TypeScript check | Passed for library, examples, scripts, and tests |
| Library build | Passed; ESM JavaScript, declarations, and source maps generated |
| Embedded PostgreSQL suite | 53 passed, zero failures; one test skipped because it requires independent PostgreSQL connections |
| PostgreSQL 18.4 suite | All 54 passed; zero failures or skips |
| Contended business effects | 64 different events across eight concurrent drainers produced one fulfillment effect and one receipt intent |
| Locked-job cleanup | An exhausted job held by another transaction did not block claiming an unrelated ready job |
| Worker lifecycle | Abort stopped new claims, drained in-flight calls, and woke idle polling promptly |
| Diagnostic isolation | Observer failures did not change payment results; diagnostic events omitted raw errors and payloads |
| Actual Stripe SDK with local HTTP fixture | API version, account header, idempotency key, request encoding, and retrieval replay passed |
| Express HTTP integration | Verified an actual request over the original signed payload |
| Next.js 16.3.6 build | Passed for Checkout/webhook routes and home/success/cancel pages |
| Offline demo | Duplicate delivery and two distinct events produced one business effect and one pending receipt intent |
| Migration protocol | Repeatability, checksums, competing runners, and unknown future migration rejection passed |
| Installed package | Packed tarball installed into a separate consumer with no repository development dependencies |
| Consumer imports and types | Core, Express, Next.js, and migration exports loaded; strict consumer compilation passed |
| Installed migration command | Applied or verified the packaged schema on PostgreSQL; a second invocation reported it up to date |
| Runtime dependency audit | npm reported zero known vulnerabilities for the checked dependency set |
| Dependency notices | Generated notices for 26 actual runtime dependencies; development-only and extraneous modules excluded |
| Documentation build | 15 guides, approximately 21,300 words, with offline navigation, search, section links, and print styles |
| Documentation checks | Local links, page anchors, duplicate IDs, embedded script syntax, and CSP hash passed |
| Documented integration snippets | Six TypeScript snippets compiled; the complete customer tutorial passed JavaScript syntax checking |
| Staged-secret hook | Previously verified to accept clean content and reject a synthetic credential without printing it |

The full `release:check` pipeline passed. Afterward, final documentation navigation and dependency-notice filtering received their relevant formatting, generation, and documentation checks. The final package was regenerated from that source.

## What these checks establish

The tests exercise specific failure and recovery behavior, including duplicate commands, conflicting payloads, stale leases, rollback, review cutoffs, signature and scope checks, outbox retries, and current-state projections. Real PostgreSQL tests use separate connections; the embedded engine provides fast local testing but cannot replace those connection-level checks.

The package installation test runs outside the source checkout. It checks that consumers receive the compiled exports, declarations, migration files, CLI, and license files. Consumer installation does not execute package lifecycle scripts.

CI is configured for Node.js 22 and 24 with PostgreSQL 17. Those remote CI jobs have not been executed in this workspace; the observed local runtime and database versions are listed above.

## Checks still needed for a deployment

No Stripe credentials were supplied. Actual sandbox API requests, Dashboard exercises, issuer-authentication scenarios, and live payments were not executed. The optional sandbox smoke test and operations workbook cover that next stage.

The local HTTP fixture uses the official SDK but does not reproduce the whole Stripe service. The concurrency scenario checks a particular invariant; it is not a throughput benchmark, failover exercise, or proof of capacity for a large production workload. No independent security audit or compliance certification is claimed.

The browser policy prevented a rendered review of the local HTML documentation. Its generation, structure, navigation source, links, and script integrity were checked directly. A rendered visual review is not included in these results.

The example identity policy is sandbox-only. A deployed application needs real authentication, tenant and resource authorization, approved commercial terms, monitored infrastructure, retention rules, and reconciliation. Follow [Deployment and publishing](docs/14-deployment-and-publishing.md).

At the time of these local checks, no npm package or repository had been published. No customer was contacted and no financial action was taken in a Stripe account. The temporary verification database is not a project dependency and was stopped after testing.

## Reproduce

```sh
npm ci
npm run release:check
npm run demo
```

For the database suite, set `TEST_DATABASE_URL` to a disposable PostgreSQL database. Those tests truncate SafeStripe tables. Set `PACKAGE_DATABASE_URL` when running `npm run test:package` to test migrations from the installed archive. See the [publishing guide](docs/14-deployment-and-publishing.md) for the complete commands and release sequence.
