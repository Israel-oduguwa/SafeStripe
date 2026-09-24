# Choose a database

SafeStripe stores operation history, pending webhooks, outbox messages, effect guards and application billing records. These records must survive restarts. A process-local Map cannot reliably prevent duplicate work across servers.

You can keep the rest of your application in any database. For atomic fulfillment, put the billing state and outbox intent inside the chosen SafeStripe transaction. If your main application data lives elsewhere, deliver an idempotent outbox message to update it. Two unrelated databases cannot share one local transaction.

## Supported adapters

| Database | Best starting point | Required extra package | Hosting constraint |
| --- | --- | --- | --- |
| SQLite | Local learning and tests | None | Persistent file on one computer; sandbox factory only |
| PostgreSQL | Existing SQL applications and durable workers | `pg` | A shared PostgreSQL service |
| MongoDB | Applications already using MongoDB | `mongodb` | Atlas or a replica set with transaction support |
| Cloud Firestore | Firebase applications using Firestore | `@google-cloud/firestore` | Server credentials, indexes and IAM permissions |

These adapters share a transaction protocol and the same operation/job implementation. They do not have identical throughput, costs or operational behavior. In particular, the portable queue uses bounded candidate reads and transactional claims; it is not a substitute for a measured large-scale message broker.

## Create your storage

These snippets are complete storage modules. Use one, then pass `storage` to `createSafeStripe`. Environment values come from your own deployment. MongoDB and Firestore drivers are optional; importing the package's main entry point does not load them.

:::tabs database
:::tab SQLite
```ts
import { sqliteStorage } from '@safestripe/core/storage/sqlite';

export const storage = await sqliteStorage({
  filename: './.data/billing.sqlite',
});
```

The adapter creates the directory and tables. It uses WAL journaling, full synchronous writes and serialized transactions within each connection. A small local web process and worker may share the same file on the same computer. Keep it off network filesystems. Never delete the file to recover an uncertain payment.

Node.js 22.19+ is required. Node 22 labels `node:sqlite` experimental. Use shared storage for live or distributed applications; `createSafeStripe` refuses live keys with this adapter.
:::tab PostgreSQL
```ts
import { Pool } from 'pg';
import { postgresStorage } from '@safestripe/core/storage/postgres';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 5000,
  statement_timeout: 15000,
  idle_in_transaction_session_timeout: 20000,
});

pool.on('error', () => {
  console.error('Billing database connection interrupted');
});

export const storage = await postgresStorage({ db: pool });
```

Before first startup, run migrations with a deployment role that can change the schema:

```bash
DATABASE_URL="your_database_connection_string" npx safestripe migrate
```

For a disposable development database, `postgresStorage({ db: pool, migrate: true })` can apply migrations automatically. Production request handlers should not require schema-change privileges.

The portable adapter uses serializable transactions with bounded retries. Keep pool sizes small per process and calculate the total across replicas. Use your provider's documented TLS configuration; do not disable certificate validation to make a connection succeed.
:::tab MongoDB
```ts
import { MongoClient } from 'mongodb';
import { mongoStorage } from '@safestripe/core/storage/mongodb';

export const client = new MongoClient(process.env.MONGODB_URI!, {
  maxPoolSize: 5,
  serverSelectionTimeoutMS: 5000,
});
await client.connect();

export const storage = await mongoStorage({
  client,
  database: 'billing',
});
```

Atlas avoids running MongoDB on your computer. Initialization verifies that transactions are available and creates the queue index. A standalone server is rejected. The database user needs access to this database and permission to create the index during setup.

The adapter uses snapshot transactions, majority write concern and forced writes to read dependencies. This last step prevents concurrent handlers from making conflicting decisions using stale business records. It adds write cost, so measure hot-order contention before scaling worker counts. Keep transaction callbacks short and do not perform parallel operations inside them.
:::tab Firebase
```ts
import { Firestore } from '@google-cloud/firestore';
import { firestoreStorage } from '@safestripe/core/storage/firestore';

export const firestore = new Firestore({
  projectId: process.env.GOOGLE_CLOUD_PROJECT,
});

export const storage = await firestoreStorage({ db: firestore });
```

Use Application Default Credentials on supported infrastructure or your platform's documented workload identity setup. For local development with a service-account file, `GOOGLE_APPLICATION_CREDENTIALS` points to that private file. Never put the file in Git or browser code. On Vercel, configure an appropriate server credential strategy; a Firebase browser configuration object is not sufficient.

The default collection is `safestripe_records`. The worker query needs a composite index with `scope`, `queue`, and `dueAt` in ascending order. The supplied [Firestore index configuration](../examples/firestore/firestore.indexes.json) also exempts the record `value` map from indexing so large event payloads do not create unnecessary index entries. Deploy it through your Firebase project, or create the equivalent indexes in its console. Missing indexes produce a setup error containing a creation link. [Firestore index documentation](https://firebase.google.com/docs/firestore/query-data/indexing).

Deny browser access to this collection. The server SDK uses IAM; Firebase Security Rules do not restrict a privileged server credential. Grant the service only the project access it needs. Existing broad rules must not override your intended denial through another matching allow rule.

```text
match /safestripe_records/{document=**} {
  allow read, write: if false;
}
```

Transactions read before writing. SafeStripe buffers writes until the callback finishes so `get` after `set` still works in your callback. Firestore may repeat the callback after contention; never send emails or charge a payment inside it.
:::endtabs

## Update billing data atomically

Use these methods inside a worker's transaction, or call `storage.transaction(billing.scopeId, callback)` for an application operation. Collection and record IDs accept letters, digits, underscores, dots, colons and hyphens, up to 200 characters. The record contents must be finite JSON values; convert dates to strings and large integer amounts to decimal strings where necessary.

```ts
await storage.transaction(billing.scopeId, async (tx) => {
  const order = await tx.get<{ state: string }>('orders', 'order-123');
  if (!order) throw new Error('Order is missing');

  await tx.effectOnce('tenant-1:order-123:fulfill', async (effect) => {
    await effect.set('orders', 'order-123', { ...order, state: 'fulfilled' });
    await effect.enqueue('tenant-1:order-123:receipt', 'order.confirmed', {
      orderId: 'order-123',
    });
  });
});
```

Call this only after your handler has verified the authorized payment. `effectOnce` prevents the same effect key from committing twice in this storage scope. The record update, effect guard and outbox intent commit together. A thrown error rolls them all back.

**Tenant isolation is still an application rule.** The storage scope separates Stripe accounts and modes; it does not automatically authorize a tenant. Include the tenant in application record/effect IDs when IDs are not globally unique, and verify ownership before calling storage methods. Do not expose `storage.read`, recovery methods or the raw database to public routes.

A transaction can be retried. Use only its data methods and bounded, repeatable reads. Do not call `billing.createRefund`, send email, grant access in another database or call a fulfillment provider from inside it. Put the intended external work in the outbox instead.

## Limits, lifetime and cleanup

The portable API limits an individual JSON payload to 512,000 bytes. The configured webhook receiver leaves space for stored metadata. Keep effects small, and remain within your provider's overall transaction size, duration and write limits. Large invoices or unusual events may need a different reviewed ingestion strategy; do not simply remove the payload bound.

`storage.close()` closes SQLite. For PostgreSQL, MongoDB and Firestore, the application owns the client it supplied: close it during process shutdown with `pool.end()`, `client.close()` or `firestore.terminate()`. Do not close it after every serverless request.

There is no automatic retention job. Operations and effects carry duplicate-prevention history; deleting them can allow an old action to run again. Define retention, backups and audit access before pruning. Firestore polling consumes reads even when there is little work; use an appropriate polling interval and watch cost.

Do not switch a running application to a new empty database. Read [the migration guide](20-upgrading.md) first.
