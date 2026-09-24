# SafeStripe

Stripe payments and billing for Node.js, Express and Next.js, with durable retries, verified webhooks and a ready-made React payment form.

A payment request can time out after Stripe has accepted it. A webhook can arrive twice. A worker can stop between updating an order and notifying another service. SafeStripe stores enough history to recover from these situations without treating every retry as a new business action.

**Status:** 0.2.0 release candidate. Available from this repository and a local package archive; not yet published to npm. MIT licensed and independent of Stripe.

[Get started](docs/11-getting-started.md) · [Local payment tutorial](docs/03-quickstart.md) · [Database adapters](docs/15-databases.md) · [Express / Next.js](docs/16-frameworks.md) · [Payment UI](docs/17-payment-ui.md)

## Start without Docker

The included sample uses a local SQLite file. You need Node.js 22.19 or later. You do not need a database server.

```bash
npm ci --ignore-scripts
npm test
cp .env.example .env
```

Follow the [local tutorial](docs/03-quickstart.md) to add sandbox credentials, a customer and a price, then forward webhooks with the Stripe CLI. Start Express with `npm run dev:express`; it also starts the worker. For the Next.js payment form, run `npm run dev:next` and `npm run worker` in separate terminals.

The sample refuses production mode. It uses a local demo token so you can learn the flow before connecting your application's real authentication and order policy.

## Install in your application

Once published, the installation will be:

```bash
npm install @safestripe/core
```

Until then, run `npm pack` in this repository and install its archive from your application:

```bash
npm install /absolute/path/to/safestripe-core-0.2.0.tgz
```

The Stripe SDK installs automatically. Add only the driver your app uses:

| Storage | Installation after publication | Use |
| --- | --- | --- |
| SQLite | `npm install @safestripe/core` | Local sandbox, built into Node |
| PostgreSQL | `npm install @safestripe/core pg` | Shared SQL database |
| MongoDB | `npm install @safestripe/core mongodb` | Atlas or a replica set |
| Firebase Cloud Firestore | `npm install @safestripe/core @google-cloud/firestore` | Server-side Firestore transactions |

The main package is ESM. React/Next.js apps import the browser component from `@safestripe/core/react`; all other entry points belong on the server. A plain Express app can use hosted Checkout without React.

## Create Checkout

After configuring your storage and application authorization policy, initialize the server once:

```ts
import { createSafeStripe } from '@safestripe/core';

const billing = await createSafeStripe({
  secretKey: process.env.STRIPE_SECRET_KEY!,
  storage,
  appOrigin: 'https://shop.example.com',
  authorize: billingPolicy,
});

const session = await billing.createCheckout(
  {
    tenantId: user.organizationId,
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
```

`storage`, `billingPolicy`, `user` and `order` come from your server application. The [framework guide](docs/16-frameworks.md) explains their contracts and supplies both route patterns. Keep the operation ID stable for retries. SafeStripe rejects changed terms under an existing identity.

The account ID is normally discovered from the secret key. A restricted key without account-read permission can use an explicit `accountId`. Webhook verification still requires a separate `whsec_…` signing secret. The publishable key is only needed for an embedded browser payment form.

## Put a payment form in your page

Create a custom Checkout Session on your authenticated server using `uiMode: 'custom'`, then pass its client secret to the component:

```tsx
import { SafeCheckout } from '@safestripe/core/react';

<SafeCheckout
  key={session.id}
  publishableKey={publishableKey}
  clientSecret={session.clientSecret}
  buttonLabel="Pay securely"
>
  <div>
    <h2>Your order</h2>
    <p>Review your purchase, then complete payment below.</p>
  </div>
</SafeCheckout>;
```

It includes Stripe's secure Payment Element, styling, loading state and confirmation controls. Your summary sits above the payment fields. Card data stays inside Stripe's fields. Fulfill through the verified webhook and stored order, not the browser callback. See [appearance options and the complete example](docs/17-payment-ui.md).

## What it takes care of

- Stable operation identities, immutable request fingerprints and retrieval on completed retries.
- A review state for unresolved operations outside the automatic retry window.
- Raw-body webhook signatures, account/mode/version checks and durable admission before acknowledgment.
- Persistent jobs with leases, bounded retries, dead-job recovery and audited replay.
- Billing-record updates, effect guards and outbox messages in one transaction.
- Four storage adapters, Express/Next.js receivers, worker shutdown handling and bounded local API concurrency.
- Common customer, Checkout, refund, invoice, subscription and portal workflows.

The [problem guide](docs/13-what-safestripe-solves.md) explains each failure scenario. The [recipes](docs/18-recipes.md) show the common calls.

## Deploy with clear boundaries

Use shared PostgreSQL, MongoDB or Firestore for deployment. Next.js routes on Vercel use the Node runtime and an external durable database; a continuous worker belongs on a host that supports long-running processes. SQLite is not a serverless persistence strategy.

Your app remains responsible for authentication, tenant/resource authorization, approved prices, entitlement policy, refund approvals, tax/accounting decisions and monitored infrastructure. Outbox delivery is at least once, so recipients must deduplicate. The default API gate is per process, not an account-wide rate limiter.

No enterprise throughput, zero-error guarantee, independent security audit or compliance certification is claimed. Read [deployment](docs/14-deployment-and-publishing.md), [larger-system architecture](docs/19-enterprise.md) and the [verification record](VERIFICATION.md) before enabling live payments.

## Documentation and maintenance

Open [the offline handbook](docs/handbook.html) for search, framework/database tabs, highlighted snippets and copy controls. Markdown versions work directly on GitHub.

The [maintainer guide](maintainer/README.md) covers your own test setup, release checks, package archives and eventual npm publishing. [Contributing](CONTRIBUTING.md), [security reporting](SECURITY.md), [release notes](CHANGELOG.md) and [third-party notices](THIRD_PARTY_NOTICES.md) are included.

Existing 0.1 PostgreSQL users should read [the upgrade guide](docs/20-upgrading.md). The portable store uses separate records; switching to an empty store does not preserve old payment history.
