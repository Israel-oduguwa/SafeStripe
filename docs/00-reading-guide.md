# Build payments with SafeStripe

SafeStripe helps your Node.js application remember what it asked Stripe to do, verify incoming payment events, and finish background work without repeating the same business action.

Use it with Express or Next.js. Start locally with SQLite, then choose PostgreSQL, MongoDB or Firebase Cloud Firestore when you deploy. The Stripe SDK is included in the package installation.

## Start with one working payment

If this is your first integration, follow these pages in order:

1. [Install and configure](11-getting-started.md). Understand the three credentials and choose a database.
2. [Make your first payment](03-quickstart.md). Run the sample locally without Docker.
3. [Connect Express or Next.js](16-frameworks.md). Add the endpoints to your own application.
4. [Add a payment form](17-payment-ui.md). Use hosted Checkout or the ready-made React component.
5. [Deploy your integration](14-deployment-and-publishing.md). Keep web requests short and run a durable worker.

Already have a Stripe integration? Read [what SafeStripe solves](13-what-safestripe-solves.md), [database adapters](15-databases.md), and [upgrading an existing integration](20-upgrading.md).

## How a payment reaches your application

A customer presses **Pay**. Your server checks their identity and selects the price from your own catalog. SafeStripe saves a stable operation identity before asking Stripe to create Checkout. The customer pays using Stripe's payment fields. Stripe then sends a signed webhook to your server. A worker verifies the current payment and updates your order inside a database transaction.

The success page is a receipt for the browser journey. The verified webhook and stored order decide whether to deliver the product.

## Choose your path

| You want to… | Read |
| --- | --- |
| Try payments without installing a database server | [Local quickstart](03-quickstart.md) |
| Use PostgreSQL, MongoDB, Firebase or SQLite | [Storage setup](15-databases.md) |
| Add Express routes or Next.js Route Handlers | [Framework integration](16-frameworks.md) |
| Style a payment form without wiring every Stripe component | [Payment UI](17-payment-ui.md) |
| Create customers, refunds, subscriptions and invoices | [Recipes](18-recipes.md) |
| Design a larger production system | [Enterprise architecture](19-enterprise.md) |
| Learn Dashboard workflows and financial operations | [Operations workbook](05-operations-workbook.md) |
| Maintain or publish this package | [Maintainer guide](../maintainer/README.md) |

## What is included

Durable operation records, request fingerprints, account and tenant scoping, signed webhook receivers, persistent jobs, bounded retries, dead-job recovery, transactional effects, an outbox, Express and Next.js adapters, and a React Checkout component.

Your application supplies authentication, resource ownership, approved prices, business rules and worker hosting. SafeStripe makes these boundaries explicit. It does not claim to make every payment integration secure automatically, and this release has no published large-scale throughput benchmark.

The package is ESM and server-side code requires Node.js 22.19 or later. Only `@israeloduguwa/safestripe/react` belongs in a client component. The SQLite adapter uses Node's built-in SQLite API, which emits an experimental warning on Node 22.
