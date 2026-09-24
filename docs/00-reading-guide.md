# SafeStripe documentation

SafeStripe helps a Node.js application keep its payment records consistent with Stripe. It stores the identity of each operation, accepts verified events into a database, and gives workers a way to finish work safely after a failure.

If you are new to payment development, start with the local demo. You can run it without a Stripe account and see why duplicate events need special handling. Then use a Stripe sandbox to take your first test payment.

## Get started

| Guide | What you will learn |
| --- | --- |
| [Getting started](11-getting-started.md) | Install the tools, run the demo, and understand the output |
| [Run a sandbox payment](03-quickstart.md) | Configure Stripe, start Express or Next.js, and verify the order |
| [Install in your application](12-integration.md) | Install the package, migrate the database, connect authorization, and run a worker |
| [What SafeStripe solves](13-what-safestripe-solves.md) | Understand each control through a failure and recovery example |

The local examples use a fixed test customer and order so you can follow the complete flow. When you add SafeStripe to an existing product, your own login and order system supply those records.

## Build and operate a payment system

| Guide | Use it when |
| --- | --- |
| [Stripe objects and state](01-objects-and-state.md) | You need to distinguish a payment, invoice, subscription, refund, and balance entry |
| [Architecture](02-distributed-architecture.md) | You are designing retries, transactions, event processing, and recovery |
| [Billing and finance](04-billing-and-finance.md) | You are handling subscriptions, prorations, money, Connect, or tax |
| [Security and scale](07-security-and-scale.md) | You are reviewing access, capacity, monitoring, and data retention |
| [Testing and runbooks](08-testing-and-runbooks.md) | You need to test a failure or investigate an incident |
| [Library reference](09-library-reference.md) | You need a method, option, error code, or extension contract |
| [Deployment and publishing](14-deployment-and-publishing.md) | You are deploying a service or releasing the npm package |

## Practice Stripe operations

The [operations workbook](05-operations-workbook.md) contains exercises for customers, payments, invoices, subscriptions, refunds, disputes, and reconciliation. Each exercise describes the starting state, permitted changes, and evidence needed to verify the result.

Use [recording and evaluation](06-evaluation-and-recording.md) to turn an exercise into a screen recording, a task prompt, and a scored review. You can complete this path without writing application code. Access to an authorized Stripe sandbox is required for the Dashboard exercises.

## A few terms before you begin

**Stripe** processes payments and provides billing services. **SafeStripe** is the library in this repository. It coordinates Stripe requests with your application's database.

A **sandbox** is a Stripe environment for testing. A **webhook** is a message Stripe sends to your server after something changes. A **worker** is a separate process that handles stored work. An **operation ID** is your application's permanent name for one intended action, such as `refund:case-184`.

The guides explain other terms when they first matter. You do not need to understand distributed systems to run the first demo.

## Versions and support

This edition targets Node.js 22+, Express 5, Next.js App Router, and PostgreSQL. It pins Stripe SDK 22.6.2 and API version `2026-08-26.dahlia`. See [sources and compatibility](10-sources-and-corrections.md) for the official references and [verification](../VERIFICATION.md) for test results.

Code blocks marked as integration sketches depend on your application's existing services. Complete runnable examples live in the source checkout. Commands that move real money are not part of the getting-started path.
