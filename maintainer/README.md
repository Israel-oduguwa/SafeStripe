# Maintaining SafeStripe

These instructions are for the package owner. Application developers should start with [the public documentation](../docs/handbook.html).

## Your first local test

You do not need Docker, PostgreSQL, MongoDB, or a Firebase emulator on your computer. Node.js 22.19 or later supplies SQLite. Use the repository's local starter; the database is a file in `.data/billing.sqlite`.

1. Open a terminal in the SafeStripe folder and run `npm ci --ignore-scripts`.
2. Run `npm test` and `npm run demo`. These use offline fixtures; they do not charge a card or contact your Stripe account.
3. Copy `.env.example` to `.env`. Keep `.env` out of Git.
4. In a Stripe sandbox, create a customer, product and one-time price. Copy the customer ID and price ID into `.env`.
5. Add your sandbox secret key. For the Next.js payment form, also add the publishable key as `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
6. Generate `DEMO_TOKEN` with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. This token signs in to the local example; it is not a Stripe key.
7. Install the [Stripe CLI](https://docs.stripe.com/cli). Run `stripe login`, then `stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded --forward-to localhost:3000/api/webhooks/stripe`. Put the printed `whsec_…` value in `.env`. Keep the listener running.
8. Leave `BILLING_DATABASE=sqlite`. Leave `STRIPE_ACCOUNT_ID` empty unless account discovery is blocked by a restricted key.
9. Run `npm run dev:express`, or run `npm run dev:next` and `npm run worker` in separate terminals. Express starts its worker itself. Next.js uses the second process on the same computer.
10. Follow [the payment test](../docs/03-quickstart.md). Use a new `DEMO_ORDER_ID` for each new purchase and when switching between hosted and embedded Checkout.

The secret API key creates Stripe objects. The publishable key loads the browser payment form. The signing secret verifies webhook messages. They serve different purposes; two API keys cannot replace the signing secret.

## Before you publish

Run `npm run release:check` and `npm audit --audit-level=high`. A failed or unavailable audit is not a clean result. CI audits the full installed graph, including example and build dependencies, and also exercises the SQL store against real PostgreSQL and runs the document adapters against isolated services on GitHub's runners. See [VERIFICATION.md](../VERIFICATION.md) for what was actually checked. A green local run does not establish throughput at enterprise scale.

Run `npm pack --dry-run` and inspect the file list. Run `npm pack` to produce the installable archive. Before publishing, test that archive in a separate app with `npm install /absolute/path/to/safestripe-0.3.0.tgz`. After publishing, repeat the consumer check using the exact version from the registry.

The GitHub repository owner and npm package name are separate. Verify publishing access to `safestripe`, enable npm account protection, and configure trusted publishing or a narrowly scoped automation token before publishing. `npm publish --access public` publishes a public artifact; do not run it until you have reviewed the package, license, release notes and passing CI. No npm release is performed by these instructions.

## Current publication and remaining owner setup

`safestripe@0.3.0` is public. Its [clean registry consumer report](../docs/evidence/npm-registry-2026-10-06.json) matches the reviewed archive and confirms that consumers use ordinary `npm install safestripe`. The old scoped 0.2.0 package is not the current library. The first unscoped publication has no CI provenance or verified signed release tag.

These remaining steps use your own accounts. Never send credentials, one-time codes, signing keys or provisioning manifests in chat or a public issue.

1. **Configure the dedicated Stripe sandbox.** Use a disposable account with synthetic data and a default portal configuration. In the repository's **Settings → Environments → stripe-sandbox**, add `STRIPE_SANDBOX_ACCOUNT_ID` as a secret or variable. Either add `STRIPE_SANDBOX_RESTRICTED_KEY` with an `rk_test_…` key and choose workflow `key_type: restricted`, or add `STRIPE_SANDBOX_SECRET_KEY` with an `sk_test_…` key and explicitly choose `key_type: secret`. A restricted key needs the access listed in [release evidence](../docs/27-release-evidence.md). The server tests do not need the publishable key. Review main's exact commit, dispatch **Dedicated Stripe sandbox** from main, and approve the protected job. Its report must be account-verified and match that commit. Do not reuse a public visitor session or an unclaimed CLI sandbox as release credentials.
2. **Use your own signing identity.** Configure Git signing with a key you control and register the public signing key on GitHub. After all checks pass on the next release commit, create an annotated signed tag matching the package version and verify that GitHub marks it verified. Do not substitute someone else's identity or an unsigned lightweight tag.
3. **Configure trusted publishing.** On npm's SafeStripe package settings, add a GitHub Actions trusted publisher for owner `Israel-oduguwa`, repository `SafeStripe`, workflow `release.yml` and environment `npm-release`. Explicitly allow direct publishing; the workflow expects a completed publication. Configure this when ready to run it: npm's initial publisher verification window is limited. A subsequent distinct version, such as 0.3.1, must repeat the checks and use its own verified tag before the trusted workflow publishes it with provenance. Never publish 0.3.0 again; versions are immutable. The first local publication cannot gain provenance afterward.
4. **Validate the intended production integration.** Keep CI's real PostgreSQL and document-adapter checks enabled. Test the selected payment methods, renewal and cancellation behavior, monitoring, authorization and a database restore on the actual deployment. The public demo is a test service, not a payment host for companies.
5. **Arrange outside review.** Give reviewers the [onboarding and security exercises](../docs/29-external-review.md). Record actual findings, timings and fixes. Independent review and production infrastructure testing remain necessary before a broad production recommendation.

The `npm-release` and `stripe-sandbox` environments require maintainer review and are restricted to main. The release workflow rejects failed or stale CI, open high/critical CodeQL findings, skipped database checks and unverified sandbox evidence. Read [release readiness](../docs/28-release-readiness.md) before changing the preview status.

## Recheck the published consumer

Run `npm run test:registry` from the repository. The script creates a separate temporary application and cache, performs a normal exact-version registry installation, checks exports, strict types and a SQLite transaction, then installs the selected peers and checks their imports. It removes the temporary app afterward and writes a sanitized report to ignored `artifacts/registry-consumer.json`.

To compare the registry bytes against a reviewed archive as well, run:

```sh
npm run test:registry -- --archive /absolute/path/to/safestripe-0.3.0.tgz
```

Use the original reviewed archive. Packing a later source revision with the same version does not recreate the published bytes and should fail this comparison. This check does not connect to production databases or certify release provenance.

## If npm shows a holding version

A version named `0.0.0-stage` is a placeholder for a new package whose actual archive is awaiting approval. It is not the usable SafeStripe library. Registry caches can also briefly show older metadata after approval. Check the exact version and latest tag:

```sh
npm view safestripe@0.3.0 version dist.integrity --registry=https://registry.npmjs.org/
npm view safestripe dist-tags --registry=https://registry.npmjs.org/
```

For a future staged release, use npm 11.15.0 or later on a supported Node version. Run `npm stage list safestripe`, then `npm stage view STAGE_ID` and `npm stage download STAGE_ID`. Compare the downloaded archive with the checked candidate before approving it. Complete approval in npm's **Staged Packages** page or with `npm stage approve STAGE_ID`. Approval requires the owner's registered two-factor method. Open a fresh verification link in the browser where that method works; expired links cannot be reused. Never delete a stage or bump a version just to bypass a failed verification. See npm's [staged publishing guide](https://docs.npmjs.com/staged-publishing/).

A successful publication makes the actual version installable. Confirm it with a clean registry consumer check, then update the demo's exact dependency and `site/release.json`. Avoid installing or promoting the holding version.

## First integration reviewers

Use the [three-developer invitation guide](https://github.com/Israel-oduguwa/SafeStripe/blob/main/maintainer/EARLY-ADOPTERS.md) for the first feedback round. It includes a short invitation, one integration task, five questions and a blank tracking template. Record assistance and blockers honestly, and ask permission before quoting someone publicly.

The [30-second recovery film](https://israel-oduguwa.github.io/SafeStripe/demo/) explains the retained sandbox evidence. Its edited reconstruction is useful as an introduction; each reviewer should still try the quickstart independently.

## Repository commands

| Command                      | Purpose                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| `npm test`                   | Offline tests, including SQLite and an embedded PostgreSQL engine                     |
| `npm run check`              | Types, tests and library build                                                        |
| `npm run build:next`         | Build the Next.js example, including the browser component                            |
| `npm run docs:build`         | Generate the offline consumer documentation                                           |
| `npm run docs:check`         | Check documentation links and compiled examples                                       |
| `npm run test:package`       | Install the packed library into a clean consumer and check exports                    |
| `npm run test:registry`      | Test a normal exact-version installation from npm in a temporary consumer             |
| `npm run licenses`           | Refresh runtime dependency license notices                                            |
| `npm run release:check`      | Run the release checks together                                                       |
| `npm run test:stripe`        | Opt-in sandbox customer create/replay/delete smoke test; read its prerequisites first |
| `npm run dev:express:legacy` | Original SQL-only example, retained for existing integrations                         |

Never include `.env`, `.data`, customer exports or recordings in a release. The git hook checks staged files for Stripe secrets. Keep the original migration files immutable; add migrations instead of editing applied history. The SQL migration runner tracks checksums.

## What remains your application's responsibility

The package cannot supply your customer login, product catalog, pricing policy, tax registration, accounting controls, refund permissions or disaster recovery plan. Do not replace the example's explicit local restriction with `authorize: async () => true` to deploy it. Implement your own policy and test tenant isolation first.

Record a sandbox payment, duplicate webhook replay, failed card and refund as separate test cases. Hide secrets before recording. Keep the advanced [operations workbook](../docs/05-operations-workbook.md) and [evaluation guide](../docs/06-evaluation-and-recording.md) for workflow practice.
