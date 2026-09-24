# Connect Express or Next.js

Both frameworks use the same billing client and storage adapter. The differences are where you read authentication, how you preserve the webhook body, and where your worker runs.

If you are learning, run the complete [local sample](03-quickstart.md) first. The snippets on this page are integration patterns for an application that already has users and orders. Imports from `./auth`, `./orders`, `./billing-policy` and `./billing-handlers` are application modules you implement, not hidden SafeStripe exports.

## 1. Set up storage and your billing client

Choose the complete PostgreSQL or MongoDB module in [database setup](15-databases.md) and save it as `billing-storage.ts`. SQLite works for the local sample; use a shared service for deployment.

Create `billing.ts` in server-only code. Cache the promise so concurrent requests reuse one initialization. Clear a failed initialization so a transient account lookup failure does not disable the instance forever.

```ts
import { createSafeStripe } from '@safestripe/core';
import { storage } from './billing-storage.js';
import { billingPolicy } from './billing-policy.js';

let pending: ReturnType<typeof createSafeStripe> | undefined;

export function getBilling() {
  return (pending ??= createSafeStripe({
    secretKey: process.env.STRIPE_SECRET_KEY!,
    storage,
    appOrigin: process.env.APP_ORIGIN!,
    authorize: billingPolicy,
  }).catch((error) => {
    pending = undefined;
    throw error;
  }));
}
```

In a Next.js application, add `import 'server-only'` to this module. Use `allowLocalhost: true` only for a sandbox origin such as `http://localhost:3000`. Set `APP_ORIGIN` to your trusted HTTPS deployment origin in production. Never derive payment return URLs from an untrusted `Host` header.

## 2. Define your authorization boundary

Your authentication helper must verify a real session or signed token. Return a server-derived user ID and tenant ID; do not copy either from a request body. Your order loader accepts that tenant and returns only an order it owns. Your billing policy must authorize the action, customer, price and relevant commercial parameters again, including on a replay.

An order used below has `id`, `tenantId`, `stripeCustomerId`, `stripePriceId` and `quantity`. It is loaded from your database. The example uses a fixed `payment` mode; recurring prices need a subscription workflow and a separate entitlement policy.

Cookies require your normal CSRF protection. The snippets enforce a fixed same-origin browser request as one part of that boundary. Machine-to-machine clients need their own authenticated API route and policy; do not weaken the browser route to accommodate them.

## 3. Create Checkout on the server

Only accept an order ID from the browser. Choose the customer, price, quantity and return origin on the server. Reject expired, cancelled, already fulfilled or otherwise ineligible orders in your loader/policy. Serialize changes to commercial terms before starting Checkout; an operation fingerprint is not a stock reservation system.

:::tabs framework
:::tab Express.js
```ts
import express from 'express';
import { publicError } from '@safestripe/core';
import { getBilling } from './billing.js';
import { requireUser } from './auth.js';
import { loadPayableOrder, bindCheckout } from './orders.js';

export const checkoutRouter = express.Router();

checkoutRouter.post('/checkout', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.get('origin') !== process.env.APP_ORIGIN) {
      res.status(403).json({ error: 'ORIGIN_NOT_ALLOWED' });
      return;
    }
    const user = await requireUser(req);
    const order = await loadPayableOrder(user.tenantId, req.body.orderId);
    const billing = await getBilling();
    const session = await billing.createCheckout(
      {
        tenantId: user.tenantId,
        actorId: user.id,
        operationId: `checkout:${order.id}`,
      },
      {
        customerId: order.stripeCustomerId,
        mode: 'payment',
        items: [{ priceId: order.stripePriceId, quantity: order.quantity }],
        reference: order.id,
      },
    );
    await bindCheckout(order, session.id);
    res.json({ url: session.url });
  } catch (error) {
    const result = publicError(error);
    res.status(result.status).json(result.body);
  }
});
```

Mount `express.json({ limit: '8kb' })` before this router, but **after** the webhook route. `loadPayableOrder` must validate the input type, length and ownership before using it. The complete [local Express source](../examples/local/server.ts) demonstrates request validation and safe error responses.
:::tab Next.js
```ts
// app/api/checkout/route.ts
import { publicError } from '@safestripe/core';
import { boundedBody } from '@safestripe/core/next';
import { getBilling } from '@/lib/billing';
import { requireUser } from '@/lib/auth';
import { loadPayableOrder, bindCheckout } from '@/lib/orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    if (request.headers.get('origin') !== process.env.APP_ORIGIN) {
      return Response.json({ error: 'ORIGIN_NOT_ALLOWED' }, { status: 403, headers });
    }
    const user = await requireUser(request);
    const input = JSON.parse((await boundedBody(request, 8192)).toString());
    const order = await loadPayableOrder(user.tenantId, input.orderId);
    const billing = await getBilling();
    const session = await billing.createCheckout(
      {
        tenantId: user.tenantId,
        actorId: user.id,
        operationId: `checkout:${order.id}`,
      },
      {
        customerId: order.stripeCustomerId,
        mode: 'payment',
        items: [{ priceId: order.stripePriceId, quantity: order.quantity }],
        reference: order.id,
      },
    );
    await bindCheckout(order, session.id);
    return Response.json({ url: session.url }, { headers });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json({ error: 'INVALID_JSON' }, { status: 400, headers });
    }
    const result = publicError(error);
    return Response.json(result.body, { status: result.status, headers });
  }
}
```

`boundedBody` prevents an unbounded JSON read. Your order loader still validates the parsed object's structure and requested order ID. Never place this route in the Edge runtime. The complete [Next.js sample route](../examples/nextjs/app/api/checkout/route.ts) includes the restricted local policy.
:::endtabs

`bindCheckout` is an application transaction: attach the returned Session ID to the stored, immutable commercial terms only if no conflicting binding exists. Do not return a successful response before the binding is durable. A webhook can arrive first; its worker must retry an unknown binding, then alert/reconcile if the binding never appears. The [local runtime](../examples/local/runtime.ts) demonstrates the storage transaction and verification steps.

On the browser, navigate to the returned hosted Checkout URL after a successful authenticated response. For the embedded component, create the Session with `uiMode: 'custom'` and return only its ID and client secret to the authorized customer. See [payment UI](17-payment-ui.md).

## 4. Accept signed webhooks

Create a receiver from your cached billing client. Event types must match the handlers your worker actually implements.

```ts
const receiver = billing.webhooks({
  signingSecrets: [process.env.STRIPE_WEBHOOK_SECRET!],
  eventTypes: [
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
  ],
});
```

:::tabs framework
:::tab Express.js
```ts
import express from 'express';
import { expressWebhook } from '@safestripe/core/express';

const app = express();
app.post(
  '/api/webhooks/stripe',
  express.raw({
    type: 'application/json',
    inflate: false,
    limit: receiver.maxBytes,
  }),
  expressWebhook(receiver),
);
app.use(express.json({ limit: '8kb' }));
```

Mount this route before any JSON parser or body-transforming middleware. Stripe signs the original bytes, not a parsed and re-serialized object.
:::tab Next.js
```ts
// app/api/webhooks/stripe/route.ts
import { nextWebhook } from '@safestripe/core/next';
import { getBilling } from '@/lib/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const billing = await getBilling();
  const receiver = billing.webhooks({
    signingSecrets: [process.env.STRIPE_WEBHOOK_SECRET!],
    eventTypes: [
      'checkout.session.completed',
      'checkout.session.async_payment_succeeded',
    ],
  });
  return nextWebhook(receiver)(request);
}
```

Pass the untouched Request. Do not call `request.json()` first. The adapter streams the body with a byte limit, verifies its signature and persists the event before acknowledging it.
:::endtabs

## 5. Run a worker

A worker is a long-running process that repeatedly takes one stored event, applies your handler and records the result. It is separate from the customer's HTTP request.

```ts
import { runWorkerLoop } from '@safestripe/core';
import { getBilling } from './billing.js';
import { paymentHandlers } from './billing-handlers.js';

const billing = await getBilling();
const worker = billing.worker(paymentHandlers);
const stop = new AbortController();

process.once('SIGTERM', () => stop.abort());
process.once('SIGINT', () => stop.abort());

await runWorkerLoop(() => worker.runOnce(), {
  signal: stop.signal,
  concurrency: 4,
  pollIntervalMs: 1000,
});
```

`paymentHandlers` must retrieve the current Stripe resource, check its stored order binding and terms, and commit an effect through the supplied `BillingTransaction`. The complete [sample handler](../examples/local/runtime.ts) checks customer, reference, mode, price, quantity, completion and payment state. Do not replace those checks with `event.type === 'checkout.session.completed'` alone.

Stop accepting new work on shutdown, drain the loop, then close your database client. Keep a handler comfortably within its lease. There is no automatic lease heartbeat.

## 6. Use Next.js on Vercel

Choose hosted PostgreSQL or MongoDB Atlas and initialize a small shared pool/client at module scope. Configure the Stripe and database secrets separately for Preview and Production. Register the deployed HTTPS webhook URL with Stripe and use **that destination's** signing secret. Keep production Preview builds away from the live account.

Vercel runs the web routes. Run the continuous worker on a service that supports long-running Node.js processes, against the same database and Stripe scope. Do not start `runWorkerLoop` inside a Route Handler or leave a promise running after returning the response.

A scheduled, authenticated, bounded worker endpoint can suit low-volume jobs, but you must design its scheduling, time budget, retry and overlapping-run behavior. It is not provided as a magic unlimited background process. Check your hosting plan's [function duration and connection limits](https://vercel.com/docs/functions/limitations).

Never place the SQLite file in `/tmp` or your deployed application directory and treat it as persistent billing storage. Read [deployment](14-deployment-and-publishing.md) for the full release checklist.
