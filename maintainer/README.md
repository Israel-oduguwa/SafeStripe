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

Run `npm pack --dry-run` and inspect the file list. Run `npm pack` to produce the installable archive. Before publishing, test that archive in a separate app with `npm install /absolute/path/to/safestripe-core-0.2.0.tgz`. After publishing, repeat the consumer check using the exact version from the registry.

The repository URL and npm scope are separate. Verify ownership of the `@safestripe` npm organization, enable npm account protection, and configure trusted publishing or a narrowly scoped automation token before publishing. `npm publish --access public` publishes a public artifact; do not run it until you have reviewed the package, license, release notes and passing CI. No npm release is performed by these instructions.

## Repository commands

| Command | Purpose |
| --- | --- |
| `npm test` | Offline tests, including SQLite and an embedded PostgreSQL engine |
| `npm run check` | Types, tests and library build |
| `npm run build:next` | Build the Next.js example, including the browser component |
| `npm run docs:build` | Generate the offline consumer documentation |
| `npm run docs:check` | Check documentation links and compiled examples |
| `npm run test:package` | Install the packed library into a clean consumer and check exports |
| `npm run licenses` | Refresh runtime dependency license notices |
| `npm run release:check` | Run the release checks together |
| `npm run test:stripe` | Opt-in sandbox customer create/replay/delete smoke test; read its prerequisites first |
| `npm run dev:express:legacy` | Original SQL-only example, retained for existing integrations |

Never include `.env`, `.data`, customer exports or recordings in a release. The git hook checks staged files for Stripe secrets. Keep the original migration files immutable; add migrations instead of editing applied history. The SQL migration runner tracks checksums.

## What remains your application's responsibility

The package cannot supply your customer login, product catalog, pricing policy, tax registration, accounting controls, refund permissions or disaster recovery plan. Do not replace the example's explicit local restriction with `authorize: async () => true` to deploy it. Implement your own policy and test tenant isolation first.

Record a sandbox payment, duplicate webhook replay, failed card and refund as separate test cases. Hide secrets before recording. Keep the advanced [operations workbook](../docs/05-operations-workbook.md) and [evaluation guide](../docs/06-evaluation-and-recording.md) for workflow practice.
