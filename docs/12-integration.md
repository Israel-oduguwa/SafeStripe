# Installation and integration

> The SQL implementation details on this page describe the original PostgreSQL API. For the portable SQLite, PostgreSQL, MongoDB and Firestore setup, start with [database adapters](15-databases.md) and [framework integration](16-frameworks.md). The current local sample defaults to SQLite; legacy SQL example commands use the `:legacy` suffix.

Add SafeStripe to a server application that already has users and orders. This guide uses Node.js 22.19 or later, PostgreSQL, and a Stripe sandbox. Keep the server entry point and secret keys out of browser components. The separate React payment component is available from `@safestripe/core/react`.

## Install

Install SafeStripe and the PostgreSQL driver in your application:

```sh
npm install @safestripe/core pg
```

TypeScript applications that import `pg` should also install its declarations:

```sh
npm install --save-dev @types/pg
```

The package uses ES modules. For a plain JavaScript app, use `.mjs` files or set `"type": "module"` in your `package.json`. A CommonJS app can load it with `await import('@safestripe/core')` inside an async function. Next.js handles the imports in server modules.

## Configure the database

Set `DATABASE_URL` in the environment. For local development, a `.env` file may contain:

```dotenv
DATABASE_URL=postgresql://safestripe:safestripe@localhost:5432/safestripe
STRIPE_SECRET_KEY=
STRIPE_ACCOUNT_ID=
STRIPE_WEBHOOK_SECRET=
```

Fill the Stripe values from your sandbox. Keep the file out of Git. In deployment, use the platform's secret store and a database connection configured for verified TLS.

Load your local environment file and run the installed migration command:

```sh
node --env-file=.env node_modules/@safestripe/core/dist/cli.js migrate
```

When your environment is already loaded, the package also exposes `safestripe migrate` through npm scripts or `npx --no-install safestripe migrate`. Use a database role allowed to create tables. Application processes should use a separate role with only the permissions they need.

A successful first run prints `Applied: 001_initial.sql`. Repeating it prints that the schema is up to date. The migration runner serializes competing runs and rejects changed or unknown migration files.

You can also run migrations from a deployment script:

```js
import { Pool } from 'pg';
import { migrate } from '@safestripe/core/migrations';

const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  console.log(await migrate(db));
} finally {
  await db.end();
}
```

Run this as a deployment step before starting workers. Do not run migrations on each HTTP request.

## First library call: create a sandbox customer

Save this as `customer.mjs` in your application. It is a local script with a fixed identity and one allowed action. It refuses live mode and is not an HTTP authentication example.

```js
import { Pool } from 'pg';
import {
  SafeStripe, PostgresOperations, createStripeClient
} from '@safestripe/core';

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  connectionTimeoutMillis: 5000,
  statement_timeout: 15000
});
const stripe = createStripeClient(process.env.STRIPE_SECRET_KEY ?? '', false);
const safe = new SafeStripe({
  stripe,
  scope: {
    platformAccountId: process.env.STRIPE_ACCOUNT_ID ?? '',
    livemode: false
  },
  operations: new PostgresOperations(db),
  appOrigin: 'http://localhost:3000',
  allowLocalhost: true,
  authorize: async ({ actor, action }) =>
    actor.tenantId === 'learning' &&
    actor.actorId === 'local-operator' &&
    action === 'customer.create'
});

try {
  const customer = await safe.createCustomer({
    tenantId: 'learning',
    actorId: 'local-operator',
    operationId: 'customer:reader-001'
  }, {
    email: 'reader@example.invalid',
    name: 'Learning customer'
  });
  console.log('Customer ID:', customer.id);
} catch (error) {
  console.error('Customer creation failed:', error.code ?? 'UNEXPECTED');
  process.exitCode = 1;
} finally {
  await db.end();
}
```

Run it:

```sh
node --env-file=.env customer.mjs
```

A successful call prints a `cus_...` ID. Run the same script again: it retrieves the same customer. If you change the email while keeping the operation ID, SafeStripe returns `PAYLOAD_CONFLICT`. To create a genuinely different customer, use a different operation ID.

This demonstrates the command contract. A failed network request should be retried with its original operation ID and original inputs. Do not generate a new ID just because the first response was lost.

## Connect your authorization policy

An `Actor` describes who is acting and which operation they intend to perform:

```ts
const actor = {
  tenantId: session.organizationId,
  actorId: session.userId,
  operationId: `checkout:${order.id}`
};
```

Here, `session` and `order` are records your application has already authenticated and loaded. They are not values to copy from an untrusted request body.

The required `authorize` callback receives the actor, account scope, action, resource IDs, and normalized parameters. It must check membership, resource ownership, and the business terms. For Checkout, that includes the customer mapping, allowed price, quantity, order reference, and mode. Reject unknown actions by default.

This integration sketch shows the boundary:

```ts
const safe = new SafeStripe({
  stripe,
  scope,
  operations: new PostgresOperations(db),
  appOrigin: 'https://your-app.example',
  authorize: billingPolicy.authorize
});

const checkout = await safe.createCheckout(actor, {
  customerId: order.stripeCustomerId,
  mode: 'payment',
  items: [{ priceId: order.stripePriceId, quantity: order.quantity }],
  reference: order.id
});
```

`billingPolicy`, `session`, and `order` are application-specific services and records. SafeStripe intentionally does not invent a login system or assume all customers in a Stripe account belong to the same tenant. See the [runnable sandbox example](03-quickstart.md) for a complete composition with a fixed test identity.

Persist the Checkout Session ID against the order before presenting its URL. If a webhook races ahead of that write, the handler must retry until it finds the mapping. If the returned session is expired or complete, use your order state to decide what the customer sees. A replay returns current Stripe state; it does not reopen an old session.

## Receive webhooks

Create one receiver for one trusted scope. Its signing secret belongs to that endpoint or local CLI listener:

```ts
import { PostgresJobs, WebhookReceiver } from '@safestripe/core';

const jobs = new PostgresJobs(db);
const receiver = new WebhookReceiver({
  stripe,
  jobs,
  scope,
  signingSecrets: [process.env.STRIPE_WEBHOOK_SECRET!],
  eventTypes: [
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed'
  ]
});
```

Register these snapshot events at API version `2026-08-26.dahlia`. The receiver requires an exact version match. Each accepted event is stored before the endpoint returns a successful response. It does not fulfill an order inside the request.

### Express 5

Install Express in your application. TypeScript applications should install its declarations too:

```sh
npm install express
npm install --save-dev @types/express
```

Mount the raw-body route before JSON parsing:

```ts
import express from 'express';
import { expressWebhook } from '@safestripe/core/express';

const app = express();
app.post('/api/webhooks/stripe',
  express.raw({
    type: 'application/json',
    limit: receiver.maxBytes,
    inflate: false
  }),
  expressWebhook(receiver)
);
app.use(express.json({ limit: '16kb' }));
```

A webhook signature covers the original bytes. Parsing JSON and recreating it before verification changes those bytes. Leave this route outside user-session authentication and CSRF middleware; its authentication is Stripe's signature plus the receiver's scope checks. Your ordinary payment routes still require your application authentication, authorization, and appropriate CSRF protection.

### Next.js App Router

Create `app/api/webhooks/stripe/route.ts`:

```ts
import { nextWebhook } from '@safestripe/core/next';
import { getBillingRuntime } from '@/lib/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const { receiver } = getBillingRuntime();
  return nextWebhook(receiver)(request);
}
```

`getBillingRuntime` is your server-only module that creates or reuses the pool, SDK, and receiver configured above. Initialize it lazily so a build does not require payment credentials. Mark the module with `import 'server-only'` in a Next.js application. Never call `request.json()` before passing the request to the adapter.

The library uses Node and PostgreSQL APIs, so this route cannot run on the Edge runtime. Use a supported PostgreSQL pooler and size connection limits for your serverless deployment. Keep the worker in a process or job that the platform awaits through completion.

## Process stored events

A worker takes a handler map. Every local write made through the supplied `tx` commits with the job's completion marker or rolls back with it.

```ts
import {
  WebhookWorker, runWorkerLoop, effectOnce
} from '@safestripe/core';

const worker = new WebhookWorker(jobs, safe.scopeId, {
  'checkout.session.completed': handleCheckout,
  'checkout.session.async_payment_succeeded': handleCheckout,
  'checkout.session.async_payment_failed': handleFailure
});
const stop = new AbortController();
process.once('SIGTERM', () => stop.abort());
process.once('SIGINT', () => stop.abort());

try {
  await runWorkerLoop(() => worker.runOnce(), {
    signal: stop.signal,
    concurrency: 4
  });
} finally {
  await db.end();
}
```

`handleCheckout` and `handleFailure` are your application's handlers. A fulfillment handler must look up the order, retrieve current payment state, check the customer, price, quantity, mode, and reference, then record the business effect. Use a key such as `tenant:order:fulfill` with `effectOnce`. Checking only the event type is insufficient.

The complete example in `examples/shared/handlers.ts` implements those checks for the sandbox order. It also shows how to enqueue a receipt intent inside the transaction. External email, shipping, and entitlement services need their own idempotent delivery protocol.

## Observe and shut down

Pass an `observer` when constructing `SafeStripe` or `WebhookWorker`, and to `runWorkerLoop` for poll failures:

```ts
import type { Observer } from '@safestripe/core';

const observer: Observer = event => {
  metrics.record(event.category, event.action, event.outcome, event.durationMs);
};
```

`metrics` represents your telemetry client. Events contain stable operation names, durations, outcomes, and selected failure metadata. They exclude request bodies and raw error messages. Keep the callback fast and use a bounded exporter. Observer failures never change the payment result.

When the stop signal is aborted, the worker loop stops starting new work and waits for current handlers. Give the process enough shutdown time for bounded Stripe reads and database transactions to finish. A handler that never resolves also prevents graceful shutdown; enforce database and network deadlines.

## Next steps

Use the [library reference](09-library-reference.md) for every method and option. Before deployment, complete the [deployment guide](14-deployment-and-publishing.md) and review the [security model](07-security-and-scale.md).
