# SafeStripe

A database-backed reliability layer for Stripe applications: durable operations, verified webhook admission, recoverable workers and transactional business effects.

PostgreSQL · MongoDB · Firestore · SQLite

Express · Next.js

A payment request can time out after Stripe accepts it. Webhooks can arrive more than once, and workers can stop partway through a job. SafeStripe keeps operation and event history in your database so a retry can continue the original action.

Requires Node.js 22.19 or later. MIT licensed. SafeStripe is independent of Stripe.

[Website](https://israel-oduguwa.github.io/SafeStripe/) · [Try the sandbox](https://safestripe-demo.vercel.app/) · [Get started](docs/11-getting-started.md) · [Database adapters](docs/15-databases.md) · [Express / Next.js](docs/16-frameworks.md) · [Release readiness](docs/28-release-readiness.md)

## Reliability comes first

The 0.3 release is in stabilization. New billing features are frozen while crash recovery, sandbox behavior, installation and release evidence are reviewed.

SafeStripe is organized around five contracts: stable operation identity, durable admission before acknowledgment, recoverable worker ownership, one committed effect per business key, and atomic state/outbox intent. Each has explicit assumptions and failure boundaries. Read [the contracts and evidence](docs/24-reliability-contracts.md), [architecture decisions](docs/adr/README.md) and [the stabilization plan](docs/25-stabilization.md).

The online sandbox is available for evaluation. The 0.3 preview is not yet an enterprise production recommendation. Hosted Checkout and several billing workflows have been exercised with real Stripe test data; custom Checkout still has an unresolved sandbox failure. The [readiness report](docs/28-release-readiness.md) separates those observations from automated tests and remaining release work.

## Install

This branch prepares the shorter npm name, **safestripe**. Publication under that name is pending; the installation examples below describe the prepared release.

```bash
npm install safestripe
```

The Stripe SDK installs automatically. You do not need a separate `stripe` installation or a build step. Install your framework and the database driver your app uses:

| Storage                  | Install                                          | Use                                |
| ------------------------ | ------------------------------------------------ | ---------------------------------- |
| SQLite                   | `npm install safestripe`                         | Local sandbox, built into Node     |
| PostgreSQL               | `npm install safestripe pg`                      | Shared SQL database                |
| MongoDB                  | `npm install safestripe mongodb`                 | Atlas or a replica set             |
| Firebase Cloud Firestore | `npm install safestripe @google-cloud/firestore` | Server-side Firestore transactions |

For Express, also install `express`. React and Next.js applications supply their own React installation. The package uses ES modules. Import the browser component from `safestripe/react`; keep the other entry points on the server. An Express app can use hosted Checkout without React.

## Create a checkout session

After configuring your storage and application authorization policy, initialize the server once:

```ts
import { createSafeStripe } from 'safestripe';

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

## Optional payment form

Install the browser dependencies only when you use the React component:

```sh
npm install @stripe/react-stripe-js @stripe/stripe-js react react-dom
```

Create a custom Checkout Session on your authenticated server using `uiMode: 'custom'`. The returned Stripe object has a `client_secret` field. Return only the ID and secret your browser needs from that authenticated route, for example `{ id: session.id, clientSecret: session.client_secret }`. In the browser, pass that response as `checkout` to the component:

```tsx
import { SafeCheckout } from 'safestripe/react';

<SafeCheckout
  key={checkout.id}
  publishableKey={publishableKey}
  clientSecret={checkout.clientSecret}
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

The website source and hosting guide are in the repository’s site directory. Preview it with **npm run site:build** followed by **npm run site:preview**.

Open [the offline handbook](docs/handbook.html) for search, framework/database tabs, highlighted snippets and copy controls. Markdown versions work directly on GitHub.

For package contributors, the [maintainer guide](maintainer/README.md) covers test setup and releases. See also [contributing](CONTRIBUTING.md), [security reporting](SECURITY.md), [release notes](CHANGELOG.md) and [third-party notices](THIRD_PARTY_NOTICES.md).

Existing 0.1 PostgreSQL users should read [the upgrade guide](docs/20-upgrading.md). The portable store uses separate records; switching to an empty store does not preserve old payment history.

## Billing models in 0.3.0

Build per-seat and multi-item subscriptions, graduated/volume prices, basic metered usage, quotes, phased schedules, invoice credits, saved-payment-method setup and marketplace transfers. Use test clocks to exercise subscription changes without waiting for a renewal date. The package also includes a browser-safe recurring-revenue calculator.

Start with [Choose a billing model](docs/21-billing-models.md), then check [Stripe account services](docs/22-account-services.md) and [metric definitions](docs/23-revenue-metrics.md). Every financial write still needs your authorization policy and a stable operation ID.

This release does not implement Metronome, all Connect configurations, Accounts v2 thin-event handling, dispute evidence submission or accounting reports. It does not establish million-user capacity. Those boundaries and the remaining application responsibilities are documented beside the examples.
