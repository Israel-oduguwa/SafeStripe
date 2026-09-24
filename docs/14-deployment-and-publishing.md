# Deploy your integration

Deploy the web application, shared database and background worker as three parts of one billing system. They use the same Stripe scope and durable operation history. The browser only talks to authenticated application endpoints and Stripe's payment fields.

## A small production deployment

For Express, run the API on your application host and run a separate Node.js worker service. Choose PostgreSQL, MongoDB Atlas or Cloud Firestore. The local SQLite starter is for a sandbox.

For Next.js on Vercel, run Route Handlers with `runtime = 'nodejs'`. Use a hosted database and a worker host that permits a continuous process. Reuse the database client within each warm instance; set small pool limits and account for the number of application and worker replicas. See [the framework walkthrough](16-frameworks.md).

## Configure environments

Use separate sandbox and production credentials, databases or namespaces, webhook destinations and origins. Define the secret key, signing secret, trusted application origin and database credentials in your platform's secret manager. Only expose the publishable key to client components.

Set the webhook destination to your deployed `/api/webhooks/stripe` URL. Select the exact snapshot API version and only the events you handle. Complete a real sandbox payment through the deployed application; a fixture event without an application order does not prove fulfillment.

For PostgreSQL, run `safestripe migrate` as a deployment step before workers start. For MongoDB, prepare the database user, replica set and queue index. For Firestore, deploy the composite index and payload index exemption. Wait for indexes to become ready before directing traffic to the worker.

## Replace the learning app's policy

The repository sample intentionally refuses production mode. A deployable application must have:

- Verified customer sessions and tenant-aware order queries.
- An authorizer that checks resource ownership, action permissions, catalog prices and allowed commercial changes.
- CSRF protection for cookie-authenticated writes and request-rate limits for your endpoints.
- Durable binding between each order, its intended terms and its Stripe Session.
- A payment verification handler, subscription entitlement rules where applicable, and idempotent fulfillment.
- A real outbox recipient that deduplicates delivery keys, or a deliberately disabled message workflow.

Do not remove the refusal and keep the demo token as your production authentication system. It exists to make a local test easy to follow.

## Release without losing payment history

Back up the billing database and verify a restore procedure. Apply backward-compatible schema changes before deploying new readers and workers. Keep old workers drained during an incompatible handler rollout. Do not clear pending jobs or operation history to make a deployment succeed.

Treat Stripe API-version changes as a separate migration. Compile against the new SDK, test new event fixtures, upgrade endpoint versions deliberately, and establish which worker owns each version during transition. The receiver rejects unexpected versions.

For a signing-secret rotation, temporarily provide both trusted secrets. Confirm events arrive using the new destination secret, then remove the old value. For API-key rotation, keep the account scope unchanged and avoid logging either key.

## Operate the system

Monitor webhook acceptance errors, oldest pending-job age, failed/dead jobs, operation review state, worker duration, database latency, local concurrency saturation and Stripe rate-limit responses. A webhook `200` means durable intake; it does not mean the product was delivered.

Run reconciliation independently of webhook delivery. Compare Stripe's current objects and money movements against your application ledger. Investigate mismatches before replaying mutations. The advanced [testing runbooks](08-testing-and-runbooks.md) and [financial workflows](04-billing-and-finance.md) cover these tasks.

Size the worker pool from measured latency and database contention. There is no published capacity claim for this package. [Enterprise architecture](19-enterprise.md) explains how to establish a capacity target and failure budget.

Package contributors should use the separate [maintainer and publishing guide](../maintainer/README.md). Application developers do not need to rebuild SafeStripe's documentation, install its development tools, or publish a package to use it.
