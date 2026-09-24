# Install and configure

Start with a Node.js application, a Stripe sandbox, and a place to store billing records. You can use a local file while learning. You do not need Docker.

## Install the package

Once the package is published to npm, use the command for your database. Until then, replace `@safestripe/core` with the path to the release `.tgz` archive. A GitHub push alone does not publish an npm package.

:::tabs database
:::tab SQLite
```bash
npm install @safestripe/core
```
SQLite is built into supported Node.js versions. No database service or extra database driver is required.
:::tab PostgreSQL
```bash
npm install @safestripe/core pg
```
Use a PostgreSQL connection string from your existing database or a hosted provider. `pg` is currently included by SafeStripe too; listing it explicitly is appropriate when your application imports it directly.
:::tab MongoDB
```bash
npm install @safestripe/core mongodb
```
Use MongoDB Atlas or a replica set. A standalone MongoDB server does not provide the transactions this adapter needs.
:::tab Firebase
```bash
npm install @safestripe/core @google-cloud/firestore
```
This adapter uses **Cloud Firestore**, through its server SDK. Firebase Realtime Database is a different product and is not supported by this adapter.
:::endtabs

Do **not** install the `stripe` package separately just to use SafeStripe. It is a pinned runtime dependency and npm installs it automatically. The Stripe browser helpers used by `SafeCheckout` are included as well. Your React or Next.js app supplies React. Express apps install Express as their web framework.

## Understand your credentials

| Setting | Where it belongs | When you need it |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` (`sk_test_…` or `rk_test_…`) | Server environment only | Creating and retrieving Stripe records |
| Publishable key (`pk_test_…`) | Browser configuration | Embedded Stripe payment fields; hosted Checkout does not need it |
| `STRIPE_WEBHOOK_SECRET` (`whsec_…`) | Server environment only | Verifying Stripe webhook messages |
| `STRIPE_ACCOUNT_ID` (`acct_…`) | Server configuration, optional | Explicit scope when account discovery is unavailable |
| Database credentials | Server environment only | A hosted database; SQLite does not need them |

A signing secret belongs to one webhook destination. The Stripe CLI prints the secret for local forwarding; a deployed destination has its own secret. Do not interchange them.

`createSafeStripe()` normally discovers your account ID from your secret key at startup. You do not have to copy it manually. Internally, the account ID still matters: it keeps records from different accounts and environments separate. A restricted key might lack permission to retrieve the account. In that case, supply `accountId` from your trusted deployment configuration.

For Stripe Connect, configure a distinct `connectedAccountId` from an authorized server-side account mapping. Never trust a browser-provided account ID. Organization keys and thin events are outside the current receiver's contract.

## Configure your environment

An `.env` file is a local text file containing settings. Add it to `.gitignore`. On a hosting platform, enter the same values in its environment settings or secret manager.

```dotenv
STRIPE_SECRET_KEY=your_sandbox_secret_key
STRIPE_WEBHOOK_SECRET=your_local_signing_secret
APP_ORIGIN=http://localhost:3000
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=your_sandbox_publishable_key
```

Only the publishable key gets the `NEXT_PUBLIC_` prefix. A variable with that prefix can be included in browser JavaScript. Never use it for a secret API key, signing secret, database password or service-account credential.

## Create the server client once

The following is an application integration pattern. `billingPolicy` is your application's authorization function: it must check the signed-in tenant, resource ownership, approved prices and the requested action. The [local quickstart](03-quickstart.md) includes a complete, deliberately restricted learning policy.

```ts
import { createSafeStripe } from '@safestripe/core';
import { sqliteStorage } from '@safestripe/core/storage/sqlite';
import { billingPolicy } from './billing-policy.js';

const storage = await sqliteStorage({ filename: './.data/billing.sqlite' });

export const billing = await createSafeStripe({
  secretKey: process.env.STRIPE_SECRET_KEY!,
  storage,
  appOrigin: 'http://localhost:3000',
  allowLocalhost: true,
  authorize: billingPolicy,
});
```

Keep this instance in server code and reuse it. The factory resolves the account once and sets the reviewed Stripe API version. A deployed application uses an HTTPS `appOrigin` and shared storage. The factory rejects a live key with SQLite.

## Three identities you will use

Every wrapped write takes an actor with three fields:

```ts
const actor = {
  tenantId: signedInUser.organizationId,
  actorId: signedInUser.id,
  operationId: `checkout:${order.id}`,
};
```

`tenantId` is the business or customer workspace. `actorId` identifies the person or service allowed to act. `operationId` identifies one intended business action. Derive them on the server.

Keep the operation ID unchanged when retrying the same action. Use a new one for a new purchase or a changed business instruction. SafeStripe rejects different inputs under an existing identity instead of silently creating a second payment.

## Before continuing

You should now know where your keys belong, which database you will use, and which part of your app decides who may pay. Next, [run a sandbox payment](03-quickstart.md) or [choose a storage adapter](15-databases.md).
