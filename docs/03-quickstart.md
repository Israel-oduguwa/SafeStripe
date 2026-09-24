# Make your first payment

This tutorial runs the included sample on your computer. It uses SQLite, a small database file. You do not install Docker or a database server.

The sample sells one server-configured product to one sandbox customer. Its local sign-in token makes the first test reproducible. It refuses production mode; a deployed app needs your real authentication and order policy.

## 1. Prepare the sample

Open a terminal in the repository folder. Install dependencies, run the offline checks, and create your private settings file:

```bash
npm ci --ignore-scripts
npm test
cp .env.example .env
```

`npm test` uses synthetic Stripe events and local test data. It does not contact Stripe. Passing this step proves local behavior, not a real payment.

Create a sandbox customer and a product with a **one-time price** in the Stripe Dashboard. Copy the `cus_…` and `price_…` IDs into `.env`. Use a price greater than zero for this tutorial; its fulfillment check deliberately requires `payment_status=paid`.

Generate a local sign-in token:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Paste the result into `DEMO_TOKEN`. This is a password for the sample, not a Stripe credential.

```dotenv
BILLING_DATABASE=sqlite
SQLITE_PATH=./.data/billing.sqlite
STRIPE_SECRET_KEY=your_sandbox_secret_key
STRIPE_WEBHOOK_SECRET=filled_in_the_next_step
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=your_sandbox_publishable_key
APP_ORIGIN=http://localhost:3000
DEMO_TOKEN=your_generated_local_token
DEMO_CUSTOMER_ID=your_sandbox_customer_id
DEMO_PRICE_ID=your_sandbox_price_id
DEMO_ORDER_ID=demo-order-001
```

Leave `STRIPE_ACCOUNT_ID` empty for automatic discovery. Keep all credentials out of screenshots, recordings and Git commits.

## 2. Forward Stripe events to your computer

Install the [Stripe CLI](https://docs.stripe.com/cli), then open a separate terminal:

```bash
stripe login
stripe listen   --events checkout.session.completed,checkout.session.async_payment_succeeded   --forward-to localhost:3000/api/webhooks/stripe
```

Copy the printed `whsec_…` secret into `.env` as `STRIPE_WEBHOOK_SECRET`. Keep the listener running. The API key lets your app talk to Stripe; the listener lets Stripe's events reach your local app.

Make sure the sandbox's snapshot events use the API version listed in the documentation footer: `2026-08-26.dahlia`. The receiver rejects another event shape/version so schema changes cannot silently enter fulfillment. See [Stripe's local webhook testing guide](https://docs.stripe.com/webhooks#test-webhook).

## 3. Start your framework

:::tabs framework
:::tab Express.js
```bash
npm run dev:express
```

The Express starter runs the web server and webhook worker in one process. Keep it open. Its source is [the local Express example](../examples/local/server.ts).

In another terminal, use your demo token to create hosted Checkout:

```bash
curl http://localhost:3000/api/checkout   -H "Authorization: Bearer YOUR_DEMO_TOKEN"   -H "Content-Type: application/json"   -d '{"uiMode":"hosted"}'
```

Open the `url` from the response in your browser. The token can appear in shell history; this is a disposable local token. Do not put your Stripe secret key in this command.
:::tab Next.js
```bash
npm run dev:next
```

In a second terminal, start the worker against the same local SQLite file:

```bash
npm run worker
```

Open `http://localhost:3000`. Enter your `DEMO_TOKEN` and press **Open secure checkout**. The page uses `SafeCheckout` to render the Stripe payment form. Its server route selects the price; the browser only requests a Checkout UI mode.

Use the Node.js runtime. The database and secret key stay in Route Handlers; the publishable key goes to the client component.
:::endtabs

## 4. Complete a test payment

For a successful sandbox card payment, use Stripe's test card `4242 4242 4242 4242`, a future expiry and any valid three-digit CVC. Never use a real card for this tutorial. See [Stripe test payment methods](https://docs.stripe.com/testing) for authentication, declines and asynchronous methods.

The expected sequence is: Checkout opens, payment completes, the CLI forwards the signed event, the receiver saves it, and the worker marks the stored order `fulfilled` after checking the current Session, customer, reference, line item and quantity.

Read the order status:

```bash
curl http://localhost:3000/api/order   -H "Authorization: Bearer YOUR_DEMO_TOKEN"
```

The final response should be `{"state":"fulfilled"}`. `pending` means the webhook or worker has not finished. The success page alone is not proof that fulfillment happened. The sample records a receipt intent in the outbox; it does not send an email.

## 5. Test the behaviors that matter

| Test | What to do | Expected result |
| --- | --- | --- |
| Same request twice | Repeat the Checkout request with the same order ID and UI mode | The same Session ID is returned |
| Changed request | Switch hosted/custom without changing the order ID | `PAYLOAD_CONFLICT`; choose a new order for a new flow |
| Restart | Stop and restart the app without removing `.data` | Operation history and order state remain |
| Invalid webhook | POST unsigned JSON to the webhook endpoint | A rejection; no order update |
| Worker interruption | Stop the Next.js worker, complete payment, restart it | Pending work is picked up from storage |
| Wrong token | Send an incorrect demo token | `403` |
| Another payment | Set a new `DEMO_ORDER_ID`, restart and pay again | A distinct Session and order |

The automated tests also exercise duplicate webhook delivery, competing workers, transaction rollback and stale ownership. Use the advanced [testing runbook](08-testing-and-runbooks.md) for failure injection.

## If something does not work

**The form cannot load:** check the publishable key, sandbox mode, returned `clientSecret`, and browser network access to Stripe.js. A hosted Session cannot initialize the custom form.

**The webhook returns an error:** check the CLI signing secret, accepted event types, snapshot API version and raw-body middleware order. Restart the app after changing `.env`.

**The order stays pending:** check that the worker is running and uses the same file or database as the web server. An event created by `stripe trigger` normally belongs to a fixture Session, not your stored order. Pay through this application's Checkout for the end-to-end test.

**Account discovery fails:** check the key and account-read permission. For a restricted key, set the trusted `STRIPE_ACCOUNT_ID` explicitly.

**SQLite prints an experimental warning:** this is Node.js reporting the status of its built-in SQLite API. It is expected on Node 22. SQLite here is a development option, not your Vercel database.

When the local payment works, move to [your own Express or Next.js application](16-frameworks.md).
