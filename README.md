# SafeStripe

Stripe workflows for Node.js, Express, and Next.js, backed by PostgreSQL.

SafeStripe keeps a record of payment operations and processes webhooks through a durable queue. When a request times out or a worker stops, your application can pick up the same operation instead of guessing whether it should create another one.

It uses the official Stripe SDK. Your application provides authentication, resource ownership, and the rules for what customers can buy.

**Status:** 0.1.0 release candidate. Available from this repository; not yet published to npm.

[Get started](docs/11-getting-started.md) · [Integration guide](docs/12-integration.md) · [API reference](docs/09-library-reference.md) · [What it solves](docs/13-what-safestripe-solves.md)

## Why SafeStripe exists

A successful Stripe request and a successful database write are separate events. A refund can succeed at Stripe while your server loses the response. A webhook can arrive twice. Two different events can ask your application to fulfill the same order.

SafeStripe gives each intended action a stable identity and stores its progress in PostgreSQL. It also separates receiving a webhook from carrying out the work it describes. That makes failures easier to recover from and leaves records that developers and operators can inspect.

| When this happens | SafeStripe handles it by |
| --- | --- |
| A caller retries after a timeout | Reusing the operation's Stripe idempotency key |
| The same operation ID arrives with a different amount or price | Rejecting the changed input |
| A webhook is delivered again | Keeping one inbox record for that event |
| Different events refer to the same purchase | Providing a transactional guard for the business effect |
| A worker crashes | Letting another worker claim expired work, with ownership checks |
| An unresolved request is older than the retry window | Moving it into a review state before another mutation |
| An order update needs to trigger an external service | Storing a delivery intent in the same transaction |

The [problem guide](docs/13-what-safestripe-solves.md) walks through each case, including the parts your application still needs to handle.

## Try it in a few minutes

You need **Node.js 22 or later** and npm. Clone the repository and run:

```sh
git clone https://github.com/Israel-oduguwa/SafeStripe.git
cd SafeStripe
npm ci
npm run demo
```

The demo runs locally with an embedded PostgreSQL engine and synthetic Stripe events. It needs no Stripe account, Docker installation, API key, or payment card.

It delivers one event twice, then another event for the same order. You should see two completed webhook jobs, one fulfillment effect, and one pending receipt intent. Nothing is charged or sent.

To check the code and build the library:

```sh
npm run check
```

Ready to take a test payment? Follow [Run a sandbox payment](docs/03-quickstart.md). It covers database setup, Stripe configuration, and running either the Express or Next.js example with a worker.

## Use it in your application

Until the npm release, build an installable package from this checkout:

```sh
npm pack
```

Then install the generated archive from your application folder, replacing the path with its location on your computer:

```sh
npm install /absolute/path/to/SafeStripe/safestripe-core-0.1.0.tgz pg
```

The working package name is `@safestripe/core`. Its npm scope still needs to be confirmed before publication. Installing the local archive works without a registry release.

SafeStripe ships ES modules and TypeScript declarations. PostgreSQL stores operations and jobs; a background worker processes accepted events. Express 5 is optional. Next.js integrations use the App Router with the Node runtime.

### Create a Checkout Session

Once you have configured a `SafeStripe` instance, a Checkout call looks like this:

```ts
const checkout = await safe.createCheckout(
  {
    tenantId: session.organizationId,
    actorId: session.userId,
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

Here, `session` is your authenticated application session, and `order` is an order you have already loaded and authorized. The configured authorizer checks resource ownership and approved terms before the Stripe call, including on a replay.

Keep the operation ID unchanged when retrying the same purchase. Use a new ID for a separate purchase. Save the Checkout Session ID against the order before returning its URL, and fulfill the order from verified payment state in the worker.

The [integration guide](docs/12-integration.md) shows how to configure the client, migrate the database, add webhook routes, and run workers. It also includes a complete first-call script that creates a sandbox customer.

## Included workflows

- **Payments and billing:** customers, hosted Checkout, unconfirmed PaymentIntents, refunds, invoice creation and finalization, subscriptions, proration previews, and billing portal sessions.
- **Webhooks:** signature verification over the original request body, account and API-version checks, Express and Next.js adapters, and database-backed admission.
- **Background work:** retries, leases, stale-worker protection, dead-letter recovery, transactional business effects, and an outbox.
- **Operations:** bounded concurrency, graceful shutdown, diagnostic hooks, balance transaction imports, and exact integer reconciliation.

## Responsibilities and limits

The required authorization callback connects SafeStripe to your application's users, tenants, and commercial rules. You also own fulfillment, refund approvals, secret storage, database backups, and reconciliation.

External services must deduplicate outbox delivery keys. The default concurrency gate limits one instance; shared Stripe accounts may need a distributed limiter. Direct SDK calls bypass the wrapper's authorization and durable-operation protocol.

This release handles API v1 snapshot events at the pinned version. Full Connect onboarding, organization-context and thin-event routing, dispute evidence submission, and double-entry accounting are outside its wrapper surface. See [Security and scale](docs/07-security-and-scale.md) and the [library reference](docs/09-library-reference.md) for the contracts.

## Documentation

| Guide | Covers |
| --- | --- |
| [Getting started](docs/11-getting-started.md) | Tools, installation, and the offline demo |
| [Sandbox payment tutorial](docs/03-quickstart.md) | A test payment through Express or Next.js |
| [Installation and integration](docs/12-integration.md) | Package setup, authorization, webhooks, and workers |
| [What SafeStripe solves](docs/13-what-safestripe-solves.md) | Failure scenarios and recovery behavior |
| [Architecture](docs/02-distributed-architecture.md) | Idempotency, transactions, queues, and ordering |
| [Stripe operations workbook](docs/05-operations-workbook.md) | Customer, invoice, subscription, refund, dispute, and reporting exercises |
| [Recording and evaluation](docs/06-evaluation-and-recording.md) | Workflow recordings, task prompts, and scoring rubrics |
| [Deployment and publishing](docs/14-deployment-and-publishing.md) | Application deployment and npm release preparation |

Browse the [documentation index](docs/00-reading-guide.md), or open `docs/handbook.html` locally for the searchable offline edition.

## Tests and compatibility

The latest local verification passed **54 tests on PostgreSQL 18.4**, along with strict TypeScript checks, a Next.js build, and installation of the packed library in a separate application. The embedded database suite passed 53 tests; one connection-level test requires a real PostgreSQL server.

The release pins Stripe SDK **22.6.2** and API version **`2026-08-26.dahlia`**. CI is configured for Node.js 22 and 24 with PostgreSQL 17. Actual Stripe sandbox payment flows and application-specific deployment checks remain part of the testing process. The [verification record](VERIFICATION.md) lists what was run and what each check establishes.

For the full local release check:

```sh
npm run release:check
```

Use a dedicated disposable database when setting `TEST_DATABASE_URL`: the database tests truncate SafeStripe tables. The [testing guide](docs/08-testing-and-runbooks.md) covers failure cases and recovery procedures.

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing payment behavior. A useful contribution explains the intended operation, what can fail, and how the change handles retries.

For vulnerabilities, follow [SECURITY.md](SECURITY.md). Keep keys, customer records, and sensitive exploit details out of public issues.

## License

[MIT](LICENSE). Third-party licenses are recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). SafeStripe is an independent project and is not endorsed by Stripe.
