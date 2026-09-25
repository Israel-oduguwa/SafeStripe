# SafeStripe

Stripe payments and billing for Node.js, Express and Next.js, with durable retries, verified webhooks and a React payment form.

A payment request can time out after Stripe accepts it. Webhooks can arrive more than once, and workers can stop partway through a job. SafeStripe keeps operation and event history in your database so a retry can continue the original action.

Requires Node.js 22.19 or later. MIT licensed. SafeStripe is independent of Stripe.

[Get started](docs/11-getting-started.md) · [Local payment tutorial](docs/03-quickstart.md) · [Database adapters](docs/15-databases.md) · [Express / Next.js](docs/16-frameworks.md) · [Payment UI](docs/17-payment-ui.md)

## Install

```bash
npm install @israeloduguwa/safestripe
```

The Stripe SDK installs automatically. You do not need a separate `stripe` installation or a build step. Install your framework and the database driver your app uses:

| Storage | Install | Use |
| --- | --- | --- |
| SQLite | `npm install @israeloduguwa/safestripe` | Local sandbox, built into Node |
| PostgreSQL | `npm install @israeloduguwa/safestripe pg` | Shared SQL database |
| MongoDB | `npm install @israeloduguwa/safestripe mongodb` | Atlas or a replica set |
| Firebase Cloud Firestore | `npm install @israeloduguwa/safestripe @google-cloud/firestore` | Server-side Firestore transactions |

For Express, also install `express`. React and Next.js applications supply their own React installation. The package uses ES modules. Import the browser component from `@israeloduguwa/safestripe/react`; keep the other entry points on the server. An Express app can use hosted Checkout without React.

## Create a checkout session

After configuring your storage and application authorization policy, initialize the server once:

```ts
import { createSafeStripe } from '@israeloduguwa/safestripe';

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
import { SafeCheckout } from '@israeloduguwa/safestripe/react';

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

## Deployment

Use shared PostgreSQL, MongoDB or Firestore for deployment. Next.js routes on Vercel use the Node runtime and an external durable database; a continuous worker belongs on a host that supports long-running processes. SQLite is not a serverless persistence strategy.

Your app remains responsible for authentication, tenant/resource authorization, approved prices, entitlement policy, refund approvals, tax/accounting decisions and monitored infrastructure. Outbox delivery is at least once, so recipients must deduplicate. The default API gate is per process, not an account-wide rate limiter.

The [verification record](VERIFICATION.md) lists the checks performed and the remaining service tests. The package has no published throughput benchmark or independent security audit. Read [deployment](docs/14-deployment-and-publishing.md) and [larger-system architecture](docs/19-enterprise.md) when planning your production integration.

## Try the examples

Clone the repository to run its examples. The local starter uses SQLite, so you do not need Docker or a database server.

```bash
npm ci
npm test
cp .env.example .env
```

Follow the [local tutorial](docs/03-quickstart.md) to add sandbox credentials, a customer and a price, then forward webhooks with the Stripe CLI. Start Express with `npm run dev:express`; it starts the worker too. For the Next.js payment form, run `npm run dev:next` and `npm run worker` in separate terminals.

These are repository commands, not installation requirements for package users. The examples use local demo authentication and reject production mode. Connect your own authentication and order policy before deploying an application.

## Documentation and maintenance

Open [the offline handbook](docs/handbook.html) for search, framework/database tabs, highlighted snippets and copy controls. Markdown versions work directly on GitHub.

For package contributors, the [maintainer guide](maintainer/README.md) covers test setup and releases. See also [contributing](CONTRIBUTING.md), [security reporting](SECURITY.md), [release notes](CHANGELOG.md) and [third-party notices](THIRD_PARTY_NOTICES.md).

Existing 0.1 PostgreSQL users should read [the upgrade guide](docs/20-upgrading.md). The portable store uses separate records; switching to an empty store does not preserve old payment history.
