# Stabilizing 0.3

The 0.3 feature surface is frozen. The release work now focuses on a reliable first integration, reproducible failures and honest evidence. A version number in package.json is not a publication record.

## Work in progress

| Work | Acceptance evidence |
| --- | --- |
| [Reliability contracts and ADRs](https://github.com/Israel-oduguwa/SafeStripe/issues/1) | Contracts linked to mechanisms, tests and limitations |
| [Process failure suite](https://github.com/Israel-oduguwa/SafeStripe/issues/2) | Real SIGKILL/SIGTERM, recovered work, effect/outbox counts |
| [Stripe sandbox E2E](https://github.com/Israel-oduguwa/SafeStripe/issues/3) | Real remote state and signed webhooks from a dedicated sandbox |
| [Benchmarks](https://github.com/Israel-oduguwa/SafeStripe/issues/4) | Reproducible workload, environment and raw measured results |
| [Installation footprint](https://github.com/Israel-oduguwa/SafeStripe/issues/5) | Core-only and optional-feature clean consumer installations |
| [Release supply chain](https://github.com/Israel-oduguwa/SafeStripe/issues/6) | Checks, signed tag, SBOM, provenance and registry consumer test |
| [Hosted sandbox](https://github.com/Israel-oduguwa/SafeStripe/issues/7) | Isolated visitors, private credential handling, real deployed walkthrough |
| [Independent onboarding](https://github.com/Israel-oduguwa/SafeStripe/issues/8) | Consented observations and fixes from unfamiliar developers |

Each issue describes remaining work. An open item is not evidence of completion. Changes move through branches, pull requests and CI. Review findings belong in reproducible issues; sensitive security details belong in private reporting.

## First-run target

The target is five minutes from a prepared environment to a local integration. It has not yet been validated with independent developers. Measure dependency installation and local startup separately from Stripe/Firebase account setup and provider index creation.

Start with [the local payment tutorial](03-quickstart.md). It uses SQLite and needs no Docker. Hosted Checkout avoids frontend dependencies. Add a dedicated sandbox restricted key, customer, price and webhook listener; then complete payment and verify the stored receipt. A success-page redirect alone is not a passing test.

For an initial reliability check without credentials:

```sh
npm ci
npm run test:chaos
```

This runs process-failure tests against a disposable local database. It is not a real payment test. PostgreSQL process tests run separately on CI or with an explicitly supplied disposable database.

## Release gates

Before publishing stable 0.3, complete real sandbox evidence for its supported first-run path, fix critical findings, review the package archive, and verify the release workflow identity. Keep the preview notice until the shorter npm name is published and a clean consumer successfully installs it.

Do not remove the earlier scoped release. Explain the migration and preserve existing users' operation history. A missing signing key, publisher configuration or independent review must remain visible as unfinished work.
