# Changelog

## 0.2.0

Release candidate; npm publication remains pending.

- Added portable transactional storage for SQLite, PostgreSQL, MongoDB and Cloud Firestore, with shared operation/job behavior.
- Added account discovery through `createSafeStripe`, custom Checkout Sessions and the `SafeCheckout` React component.
- Made SQLite the local starter default; Docker and a PostgreSQL server are no longer prerequisites.
- Added consumer-first framework/database guides, VS Code syntax colors, accessible tabs and copy controls, plus a separate maintainer guide.
- Kept the original PostgreSQL API and its history format intact. Portable records use separate storage; see the upgrade guide before switching.
- Added adapter conformance checks and isolated MongoDB/Firestore CI services.

Requires Node.js 22.19+. The SQLite adapter is a sandbox option; its underlying Node 22 API is experimental. No live payments or capacity benchmarks are established by a build.

## 0.1.0

First release candidate. Registry publication is pending.

- Added durable Stripe commands with immutable request fingerprints, retry leases, and a review state for ambiguous outcomes outside the retry window.
- Added signed webhook admission, PostgreSQL inbox and outbox queues, transactional business effects, and audited replay tools.
- Added Express and Next.js adapters, a bounded worker loop with graceful shutdown, and privacy-conscious diagnostic hooks.
- Added an installed-package migration command, TypeScript declarations, MIT licensing, dependency notices, and tarball installation checks.
- Added getting-started tutorials, integration guides, payment operations labs, and incident procedures.

The release uses Stripe SDK 22.6.2 and API version 2026-08-26.dahlia. It supports Node.js 22 and later, Express 5, and Next.js App Router with the Node runtime. See [verification](VERIFICATION.md) for the environments actually tested.
