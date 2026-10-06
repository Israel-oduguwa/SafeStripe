# Changelog

## 0.3.0 — evaluation preview (6 October 2026)

First publication under the unscoped `safestripe` name. This evaluation preview consolidates the billing scenarios and stabilization work below. Local publication does not provide CI provenance; signed, provenance-backed releases and account-verified Stripe release checks remain separate maintainer work.

- Correct custom Checkout creation for the pinned API by mapping SafeStripe's `uiMode: custom` to Stripe's `ui_mode: elements`. Existing failed operations retain their original fingerprints; use a deliberate new test operation after this correction.

- Accept Stripe Billing Meter IDs with `mtr_test_` and `mtr_live_` environment prefixes. Keep other resource validation and path restrictions unchanged.
- Document the reliability contract, transaction boundaries and recovery limits with ADRs and diagrams.
- Add real child-process crash/recovery tests, a reproducible local benchmark and an opt-in Stripe sandbox service suite.
- Make PostgreSQL and browser payment libraries optional peers. Core installations continue to include the Stripe server SDK.
- Add CodeQL, dependency review, dependency-update configuration and a gated provenance/SBOM release workflow. Publisher configuration and a verified signed tag remain maintainer setup steps.
- Wait for Stripe's payment fields before enabling confirmation. Provide bounded loading feedback and a retry that reopens the same Checkout Session rather than creating another payment. Public sandbox checks completed a payment, a declined-card retry and a 3DS challenge with signed Firestore receipts.

### Billing scenarios

- Add durable scenario methods for multi-item subscriptions, saved methods, Payment Links, tiered prices, schedules, quotes, credits, basic metering, test clocks, marketplace recipients/transfers and Identity sessions.
- Add read-only tax setup inspection and guarded optional Checkout tax, trials and promotion codes.
- Add browser-safe MRR, retention and churn calculations with explicit cohort rules.
- Document API coverage, account-managed services, Connect thin-event limitations and application responsibilities.
- Keep the pinned Stripe SDK and API contract unchanged; new methods need explicit authorizer rules.



## 0.2.0

Initial npm release.

- Added portable transactional storage for SQLite, PostgreSQL, MongoDB and Cloud Firestore, with shared operation/job behavior.
- Added account discovery through `createSafeStripe`, custom Checkout Sessions and the `SafeCheckout` React component.
- Made SQLite the local starter default; Docker and a PostgreSQL server are no longer prerequisites.
- Added consumer-first framework/database guides, VS Code syntax colors, accessible tabs and copy controls, plus a separate maintainer guide.
- Kept the original PostgreSQL API and its history format intact. Portable records use separate storage; see the upgrade guide before switching.
- Added adapter conformance checks and isolated MongoDB/Firestore CI services.

Requires Node.js 22.19+. The SQLite adapter is a sandbox option; its underlying Node 22 API is experimental. No live payments or capacity benchmarks are established by a build.

## 0.1.0

Unpublished development release.

- Added durable Stripe commands with immutable request fingerprints, retry leases, and a review state for ambiguous outcomes outside the retry window.
- Added signed webhook admission, PostgreSQL inbox and outbox queues, transactional business effects, and audited replay tools.
- Added Express and Next.js adapters, a bounded worker loop with graceful shutdown, and privacy-conscious diagnostic hooks.
- Added an installed-package migration command, TypeScript declarations, MIT licensing, dependency notices, and tarball installation checks.
- Added getting-started tutorials, integration guides, payment operations labs, and incident procedures.

The release uses Stripe SDK 22.6.2 and API version 2026-08-26.dahlia. It supports Node.js 22 and later, Express 5, and Next.js App Router with the Node runtime. See [verification](VERIFICATION.md) for the environments actually tested.
