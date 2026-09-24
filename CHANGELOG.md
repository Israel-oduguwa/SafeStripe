# Changelog

## 0.1.0

First release candidate. Registry publication is pending.

- Added durable Stripe commands with immutable request fingerprints, retry leases, and a review state for ambiguous outcomes outside the retry window.
- Added signed webhook admission, PostgreSQL inbox and outbox queues, transactional business effects, and audited replay tools.
- Added Express and Next.js adapters, a bounded worker loop with graceful shutdown, and privacy-conscious diagnostic hooks.
- Added an installed-package migration command, TypeScript declarations, MIT licensing, dependency notices, and tarball installation checks.
- Added getting-started tutorials, integration guides, payment operations labs, and incident procedures.

The release uses Stripe SDK 22.6.2 and API version 2026-08-26.dahlia. It supports Node.js 22 and later, Express 5, and Next.js App Router with the Node runtime. See [verification](VERIFICATION.md) for the environments actually tested.
