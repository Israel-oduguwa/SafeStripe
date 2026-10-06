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

Run `npm run release:check`. CI also exercises the SQL store against real PostgreSQL and runs the document adapters against isolated services on GitHub's runners. See [VERIFICATION.md](../VERIFICATION.md) for what was actually checked. A green local run does not establish throughput at enterprise scale.

Run `npm pack --dry-run` and inspect the file list. Run `npm pack` to produce the installable archive. Before publishing, test that archive in a separate app with `npm install /absolute/path/to/safestripe-0.3.0.tgz`. After publishing, repeat the consumer check using the exact version from the registry.

The GitHub repository owner and npm package name are separate. Verify publishing access to `safestripe`, enable npm account protection, and configure trusted publishing or a narrowly scoped automation token before publishing. `npm publish --access public` publishes a public artifact; do not run it until you have reviewed the package, license, release notes and passing CI. No npm release is performed by these instructions.

## Remaining owner setup

The hosted preview is deployed. Publication requires account setup that a code change cannot supply. Do these steps using your own accounts; never send credentials, one-time codes, signing keys or provisioning manifests in chat or a public issue.

1. **Refresh npm access.** Run `npm login --registry=https://registry.npmjs.org/` in your terminal and complete npm's browser authentication. Confirm `npm whoami` returns your account. An npm website login alone does not authenticate the publishing terminal. Check that the unscoped name is available before its first publication.
2. **Configure the dedicated Stripe sandbox.** Use a disposable account with synthetic data and a default portal configuration. In the repository's **Settings → Environments → stripe-sandbox**, add `STRIPE_SANDBOX_RESTRICTED_KEY` as a secret and `STRIPE_SANDBOX_ACCOUNT_ID` as a variable. The key needs the access listed in [release evidence](../docs/27-release-evidence.md). Review main's exact commit, dispatch **Dedicated Stripe sandbox** from main, and approve the protected job. Its report must be account-verified and match that commit. Do not reuse a public visitor session or an unclaimed CLI sandbox as release credentials.
3. **Use your own signing identity.** Configure Git signing with a key you control and register the public signing key on GitHub. After all checks pass on the release commit, create an annotated signed tag matching the package version and verify that GitHub marks it verified. Do not create a tag claiming somebody else's signature or attach an unsigned lightweight tag to the release workflow.
4. **Complete the first npm publication and publisher setup separately.** Trusted publishing is configured on an existing npm package. If the first checked publication is `safestripe@0.3.0`, publish it through your authenticated account as an evaluation preview, then configure its trusted publisher for `Israel-oduguwa/SafeStripe`, `release.yml`, environment `npm-release`, with direct publishing allowed. That local publication does not gain CI provenance afterward. A subsequent distinct version, such as 0.3.1, must repeat the checks and use its own verified tag before the trusted workflow publishes it with provenance. Never attempt to publish 0.3.0 again; npm versions are immutable. If first-release provenance is a requirement, stop before publishing and arrange an approved first-publication CI path instead.
5. **Verify the registry consumer and switch the demo.** Install the exact published version in a clean app, confirm core imports and the included Stripe SDK, then test selected database/framework peers. Update the demo's dependency from the preview archive to that exact registry version in a reviewed change. Mark `site/release.json` as published only after the registry check succeeds; rebuild and publish the website.
6. **Arrange outside review.** Give reviewers the [onboarding and security exercises](../docs/29-external-review.md). Record actual findings, timings and fixes. Independent review and production infrastructure testing remain necessary before a broad production recommendation.

The `npm-release` and `stripe-sandbox` environments already require maintainer review and are restricted to main. Their secrets have not been populated by repository code. The release workflow rejects failed or stale CI, open high/critical CodeQL findings, skipped database checks and unverified sandbox evidence. Read [release readiness](../docs/28-release-readiness.md) before changing the preview status.

## Repository commands

| Command                      | Purpose                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| `npm test`                   | Offline tests, including SQLite and an embedded PostgreSQL engine                     |
| `npm run check`              | Types, tests and library build                                                        |
| `npm run build:next`         | Build the Next.js example, including the browser component                            |
| `npm run docs:build`         | Generate the offline consumer documentation                                           |
| `npm run docs:check`         | Check documentation links and compiled examples                                       |
| `npm run test:package`       | Install the packed library into a clean consumer and check exports                    |
| `npm run licenses`           | Refresh runtime dependency license notices                                            |
| `npm run release:check`      | Run the release checks together                                                       |
| `npm run test:stripe`        | Opt-in sandbox customer create/replay/delete smoke test; read its prerequisites first |
| `npm run dev:express:legacy` | Original SQL-only example, retained for existing integrations                         |

Never include `.env`, `.data`, customer exports or recordings in a release. The git hook checks staged files for Stripe secrets. Keep the original migration files immutable; add migrations instead of editing applied history. The SQL migration runner tracks checksums.

## What remains your application's responsibility

The package cannot supply your customer login, product catalog, pricing policy, tax registration, accounting controls, refund permissions or disaster recovery plan. Do not replace the example's explicit local restriction with `authorize: async () => true` to deploy it. Implement your own policy and test tenant isolation first.

Record a sandbox payment, duplicate webhook replay, failed card and refund as separate test cases. Hide secrets before recording. Keep the advanced [operations workbook](../docs/05-operations-workbook.md) and [evaluation guide](../docs/06-evaluation-and-recording.md) for workflow practice.
