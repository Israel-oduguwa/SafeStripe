# Run a sandbox payment

## 1. Verify locally without credentials

Open a terminal inside `SafeStripe`. Use Node.js 22 or newer:

```sh
npm ci
npm run check
npm run demo
npm run build:next
```

`check` performs strict type checking, the offline failure tests, and a library build. The demo uses PGlite, an embedded PostgreSQL engine, and the Stripe SDK's signature test helper. It exercises durable admission and effects without touching a Stripe account. The Next.js build checks the runnable route integration; the example's production runtime remains intentionally blocked until you replace demo authentication.

The test output should show no failures. The demo should show two completed webhook jobs, one pending receipt outbox job, and one fulfillment effect. “Pending receipt” means nothing was sent. Use this distinction in a recording: intent, delivery, and acknowledgment are separate facts.

## 2. Start PostgreSQL

For the runnable Stripe examples, use PostgreSQL 17. With Docker installed:

```sh
docker compose up -d
cp .env.example .env
npm run db:migrate -- --demo
```

The Compose credentials are local development fixtures; the port binds to loopback. Use managed credentials, TLS, backups, restricted database roles, and a separate migration job in deployment. The migration script checks prior migration hashes and holds a database advisory lock. Do not edit an applied migration; create another numbered migration.

Without Docker, supply a local or dedicated development PostgreSQL connection string in `DATABASE_URL`. The offline tests do not require Docker or an external database.

## 3. Prepare a Stripe sandbox

Create or select a dedicated sandbox in your authorized Stripe account. Separate sandboxes isolate configuration and test data more effectively than sharing one development environment. Use a distinct CI sandbox if you later automate API tests. See [Stripe sandboxes](https://docs.stripe.com/sandboxes).

In that sandbox:

1. Create a fictional Customer and record its `cus_...` ID.
2. Create a Product with a one-time Price, or a recurring Price for the subscription example. Record its `price_...` ID.
3. Obtain the Stripe account ID belonging to this environment. It becomes `STRIPE_ACCOUNT_ID`.
4. Create a restricted test key with only the permissions required by the endpoints you use. Customer/Price reads and Checkout creation are needed for checkout; the worker also reads relevant sessions, line items, subscriptions, and invoices. Validate permissions in the sandbox rather than broadening all access after a failure.
5. Configure a webhook destination with API version `2026-08-26.dahlia`, snapshot payloads, and the event types listed in `examples/shared/runtime.ts`. A local Stripe CLI forwarding secret is separate from a registered endpoint secret.

Fill `.env` locally. Leave it untracked. Set `DEMO_PRICE_MODE=payment` for a one-time Price or `subscription` for a recurring Price. Choose a stable `DEMO_ORDER_ID` for one purchase. Generate a random token of at least 32 characters for `DEMO_TOKEN`. Use `APP_ORIGIN=http://localhost:3000`.

Never prefix a server secret with `NEXT_PUBLIC_`. The examples read environment variables only on the server. In production, inject secrets from the hosting platform's vault; the local environment file is a development convenience.

## 4. Start Express or Next.js

In separate terminals, start **one** web example and the worker:

```sh
# Option 1
npm run dev:express

# Option 2, instead of Express
npm run dev:next

# Separate terminal; required for both options
npm run worker
```

Both examples expose `POST /api/checkout` and `POST /api/webhooks/stripe`. They use the same core library and durable tables. The checkout endpoint accepts no price, amount, customer, account, tenant, or order overrides. Its fixed sandbox identity is deliberately small enough to audit.

Using the Stripe CLI, authenticate to the intended sandbox and forward the required events:

```sh
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Use the listener's signing secret in `.env`, then restart the web process and worker. Check a forwarded event's `api_version`; it must match the pinned version. If your listener or account emits another version, configure a matching snapshot destination or follow Stripe's current CLI version controls. Do not disable the receiver's version check to make a test appear successful. See [local webhook testing](https://docs.stripe.com/webhooks#test-locally-without-a-registered-url).

Call the demo checkout using a local script, without embedding the token in a shell command:

```sh
node --env-file=.env --input-type=module -e '
const response = await fetch(`${process.env.APP_ORIGIN}/api/checkout`, {
  method: "POST",
  headers: { authorization: `Bearer ${process.env.DEMO_TOKEN}` }
});
console.log(response.status, await response.json());
'
```

Open the returned sandbox Checkout URL and complete it using a Stripe test payment method from the [testing guide](https://docs.stripe.com/testing). Do not put real card data in sandbox recordings. Repeating the same API request should return the same session identity while the operation remains bound.

The success page does not fulfill the order. Wait for the worker and inspect the application record:

```sql
SELECT order_id, session_id, state FROM sf_demo_orders;
SELECT queue, id, type, state, attempts, error_code FROM sf_jobs ORDER BY created_at;
SELECT effect_key FROM sf_effects;
```

For one-time payments the expected order state is `fulfilled`; for subscription Checkout it is `checkout_complete`. Subscription access is intentionally left to your product's entitlement policy. The worker stores current subscription and invoice projections and queues billing-review intents. It does not send recovery emails or implement a universal access policy.

`stripe trigger` generates unrelated fixture objects. Those may be accepted into the inbox but cannot fulfill your demo order because they lack its resource mapping. For a true end-to-end exercise, complete the Checkout Session created by this application.

## 5. Run the sandbox API smoke test

After migrations and key configuration:

```sh
STRIPE_SMOKE_CONFIRM=sandbox npm run test:stripe
```

This opt-in command creates one synthetic customer, replays the durable create operation, verifies the same ID, and deletes the temporary customer. It refuses live keys. Grant the necessary customer permissions to the restricted key. This is a narrow API contract check, not a full payment test or proof of settlement behavior.

## 6. Test with PostgreSQL

Point the test suite at a **dedicated disposable database**:

```sh
TEST_DATABASE_URL=postgresql://safestripe:safestripe@localhost:5432/safestripe_test npm test
```

The suite truncates SafeStripe tables between tests. Never use a database containing important records. When this variable is absent, tests use isolated PGlite instances. The CI workflow runs both variants, then builds Next.js and audits production dependencies.

## Add it to your application

Follow [Installation and integration](12-integration.md) to install the npm tarball, run packaged migrations, and configure your own application. The source examples use local imports so they can exercise changes before release. Consumer applications use the package exports.

Create one SDK client and a bounded pool per long-lived process. A tenant-scoped `SafeStripe` facade supplies a trusted account scope and a mandatory authorizer. In a shared-account SaaS, tenants still need separate application Customer mappings. Connected-account headers do not replace tenant authorization.

Make operation IDs stable across retries and unique across deliberate new purchases. For invoice workflows, use separate stable step IDs such as `invoice:case-1:create`, `invoice:case-1:item-1`, and `invoice:case-1:finalize`.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `RAW_BODY_REQUIRED` | Express raw middleware must precede JSON middleware |
| `INVALID_WEBHOOK` | Secret, original body, clock, account, mode, API version and payload family |
| Webhook 200 but order pending | Worker running, session mapping, retry/dead-letter state |
| `PAYLOAD_CONFLICT` | You changed an immutable order or reused an operation ID for another action |
| `BUSY` | A live operation owns the lease, or the local concurrency gate is full |
| `REVIEW_REQUIRED` | Inspect remote outcome and business records before any new financial command |
| Next.js refuses production execution | Replace the demo runtime with real authentication/authorization; do not remove the guard alone |
| SDK permission error | Restricted key lacks a required resource permission; inspect request logs |

Close a local demo with Ctrl-C. Keep its database if you want to inspect records. `docker compose down` stops services; adding `-v` destroys the demo data and is not required for normal shutdown.
