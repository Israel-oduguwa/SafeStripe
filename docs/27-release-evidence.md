# Release and sandbox evidence

SafeStripe 0.3 is in stabilization. A green unit suite is one release input. The naming transition, real sandbox walkthrough and public deployment are separate gates.

## Run the real Stripe service checks

Use a dedicated sandbox containing no real customer information. Create a restricted key with account read; customer, product, price, Checkout Session, PaymentIntent, refund, subscription and billing portal access required by the test. Save a default portal configuration in that sandbox first. These tests create test objects and archive or cancel their fixtures afterward. Stripe retains the associated history.

Set `STRIPE_SECRET_KEY`, the expected `STRIPE_ACCOUNT_ID`, and `STRIPE_E2E_CONFIRM=disposable-sandbox` privately in your local environment, then run:

```sh
npm run test:stripe:e2e
```

The runner rejects live keys, unrestricted keys and a different account. It uses the actual Stripe SDK and test API. It tests an ambiguous customer write by discarding a successful remote HTTP response, then verifies one remote customer after replay. It also checks hosted and Elements Checkout, refund, subscription and portal creation. `uiMode: custom` maps to Stripe’s `elements` parameter on the pinned API. Missing permissions fail the run; they do not produce a passing skip.

Its report in `artifacts/stripe-e2e.json` records the SDK, API version and completed checks without keys, portal URLs or customer payloads. The local operation database is under ignored `.data/`. If the runner is killed or cleanup fails, inspect that sandbox for `SafeStripe E2E` products and synthetic `example.invalid` customers before another run.

The [retained service report](evidence/stripe-service-2026-10-06.json) records six successful checks on 6 October 2026. Its temporary sandbox limitations are explicit; it is not evidence that the protected release gate has passed. The [benchmark report](../benchmarks/README.md) records actual PostgreSQL measurements and recovery counts separately.

For a locally provisioned, unclaimed Stripe CLI sandbox, the runner also accepts `STRIPE_E2E_TEMPORARY_SANDBOX_FILE`: a private JSON file containing the CLI's provisioning response. Keep it under ignored `artifacts/`, set its permissions to owner-only, and never attach it to an issue. The manifest must contain a temporary `rkcs_test_` key, the expected account ID and an unexpired short lifetime. This mode records that account details cannot be read remotely. It creates a default portal fixture only in that temporary sandbox. Its evidence is useful for API compatibility and replay; the release workflow does not accept it as account-verified release evidence. The public demo accepts normal test keys, not these temporary CLI credentials.

The GitHub workflow **Dedicated Stripe sandbox** is manual. Configure the protected `stripe-sandbox` environment with `STRIPE_SANDBOX_RESTRICTED_KEY` as a secret and `STRIPE_SANDBOX_ACCOUNT_ID` as a variable. Never make these available to arbitrary pull-request code. Review the commit before dispatching it.

This script does not complete a browser Checkout or receive a real network webhook. Those checks belong in the deployed demo: pay with a test card, confirm the verified Firestore receipt, resend the event, restart the host, and check the same receipt again. Record the URL, commit, time and observed result without exposing payment data.

## Release provenance

The `Publish verified release` workflow requires an existing annotated tag with a GitHub-verified signature, a tag commit on `main`, a matching package version and an npm trusted publisher. Before building, it requires successful database CI, CodeQL and account-verified Stripe service evidence on that exact tag commit; a passing run from an older revision is insufficient. It then runs the local release checks again. It generates a CycloneDX SBOM and SHA-256 checksums, publishes with provenance, and attaches the evidence to the GitHub release.

Before enabling it:

1. Set required reviewers and deployment restrictions for the `npm-release` GitHub environment. Require the database and security CI jobs on the release commit.
2. Configure your own signing identity and register its public key with GitHub. Create and verify an annotated signed tag; do not substitute another person's identity.
3. Complete the first publication of the unscoped package through your npm account if necessary. Configure its trusted publisher for this repository, `release.yml` and the `npm-release` environment. Explicitly allow direct publishing: newer npm trusted-publisher configurations otherwise default to staged publishing.
4. Dispatch the workflow for that tag. Confirm the npm package, provenance statement, GitHub artifacts and website all refer to the same version before marking the release published.

The workflow uses npm 11.15.0 on Node 24 and does not restore a dependency cache in the publishing job. Trusted publishing requirements can change; check [npm's current setup](https://docs.npmjs.com/trusted-publishers/) when configuring the account. Credentials are deliberately absent from the workflow.

A verified tag identifies a signer. Provenance links the package to a build. An SBOM describes dependencies. None is a security audit. CodeQL, dependency review, Dependabot, runtime audit and the repository's limited Stripe-secret scan provide additional signals; review and resolve their findings.

## A three-minute recovery demonstration

Start with an isolated PostgreSQL test database. Docker is optional; a local PostgreSQL service or disposable hosted database works. Keep its connection string in the environment as `CHAOS_DATABASE_URL`.

```sh
node --import tsx --test --test-name-pattern='postgres: SIGKILL at claim' tests/chaos/recovery.test.ts
```

Explain the test as it runs: worker A claims the job; the parent sends `SIGKILL`; the database retains the lease; after expiry worker B commits fulfillment, an effect guard and one outbox intent. Show the assertion in the source alongside the result. Then run the duplicate-admission case:

```sh
node --import tsx --test --test-name-pattern='postgres: 100 repeated' tests/chaos/recovery.test.ts
```

The repeated-event test includes 20 competing PostgreSQL child processes. Show the final stored counts. This is an executable demonstration script, not a claim that a video or independent review already exists.
