# Deployment and publishing

There are two releases to prepare: your application deployment and the SafeStripe npm package. They have different owners and checks. Deploying the application requires your Stripe configuration and business policy; publishing the package makes the reusable library available to other developers.

## Deploy an application

### Separate the running parts

Use a web process for authenticated payment routes and webhook admission. Use a worker process for stored events. Add an outbox dispatcher when you deliver work to another service. They share PostgreSQL but can scale independently.

Run migrations once as a deployment job with a DDL-capable database role. Start the new worker and web versions after the migration succeeds. Use a stable, restricted runtime role for normal queries. Test backup restoration and the recovery procedure before relying on the database as payment history.

The included Express and Next.js applications are sandbox examples. Their fixed identity policy deliberately refuses production execution. Replace the demo composition with your real session, tenant, order, and authorization services. Removing the environment guard alone is not a deployment procedure.

### Configure each environment

Keep development, CI, staging, and live resources separate. Verify the account ID against the key you selected, and ensure a connected-account scope uses the intended account. The account ID in configuration is trusted metadata; the library does not discover ownership from the key automatically.

| Setting | Deployment decision |
| --- | --- |
| Stripe key | Restricted key in a secret vault, with permissions for the selected methods |
| Signing secrets | Endpoint-specific secrets with a bounded rotation overlap |
| API version | Snapshot endpoint matching `2026-08-26.dahlia` |
| Database | Verified TLS, backups, connection limits, timeouts, and restricted access |
| Application origin | A configured HTTPS origin under your control |
| Authorization | Authenticated actor, tenant membership, resource ownership, approved terms |
| Workers | Supervision, graceful shutdown allowance, concurrency, and dead-job alerts |
| Reconciliation | Scheduled comparison, discrepancy owner, and restore recovery procedure |

The SDK client returned by `createStripeClient` uses a ten-second request timeout and two SDK network retries. Budget the whole attempt, including retry delays. A handler that holds a database transaction while reading Stripe should use shorter reads and avoid nested retries. See the source example's handler configuration.

### Set a connection budget

Calculate the total possible database connections across web replicas, worker replicas, reconciliation jobs, and migration jobs. Leave capacity for administration and recovery. A pool of ten in each of 50 processes is a possible 500 connections.

Choose worker concurrency based on transaction duration and database capacity. Start below your measured limit and increase it while observing queue age, lock wait, Stripe rate limits, and resource use. One hot subscription can serialize work on its resource lock even when unrelated subscriptions process quickly.

`ConcurrencyGate` limits one instance. For shared account-wide capacity, pass an implementation of `ExecutionGate` that coordinates the relevant services. A distributed limiter must itself have clear outage behavior; decide whether to reject work or queue it durably when that service is unavailable.

### Monitor outcomes

Track admission failures, pending-job age, retries, dead jobs, operations awaiting review, and reconciliation differences. Use the observer hooks for operation and handler latency. They do not replace database backlog metrics or an application audit trail.

For a small installation, these operator queries show current work:

```sql
SELECT queue, state, count(*)
FROM sf_jobs
GROUP BY queue, state;

SELECT queue, min(created_at) AS oldest_pending
FROM sf_jobs
WHERE state = 'pending'
GROUP BY queue;

SELECT kind, state, count(*)
FROM sf_operations
WHERE state IN ('running', 'retry', 'review')
GROUP BY kind, state;
```

These are administrative scans. On large tables, use a measured sampling interval and a reporting strategy that does not compete with payment traffic. Archive completed payloads under a reviewed retention policy, while preserving the identities and effect guards needed for deduplication. Avoid deleting records merely to make an alert disappear.

### Prove the flow in a sandbox

Before live rollout, complete a successful payment, a delayed payment, an authentication-required payment, a failed renewal, a partial refund, and cancellation at period end. Verify the application state, Stripe state, and associated financial records. Exercise an interrupted request and a stopped worker.

Then rehearse rollback and database restoration. Deploy to limited traffic, compare outcomes, and expand only after the agreed checks pass. The [verification record](../VERIFICATION.md) describes library tests; it does not replace this application-specific exercise.

## Prepare the npm package

### Choose the published identity

The working package name is `@safestripe/core`. It is a placeholder until the maintainer confirms ownership of that npm scope. Use an account or organization you control. Do not publish under someone else's scope or assume that an unclaimed name is reserved for you.

Update `name` in `package.json` and refresh the lockfile. Replace the package name in installation commands, imports, and CLI paths if you rename it. Add real `repository`, `homepage`, and `bugs` metadata after creating the repository. Do not add placeholder contact addresses to a public release.

The package has an MIT license, a project notice, a changelog, a contribution guide, and generated third-party notices. The copyright line uses “SafeStripe contributors.” Confirm the appropriate rights holder before your first publication. Preserve dependency licenses when redistributing their code or notices.

### Check the release

From a clean checkout:

```sh
npm ci
npm run release:check
npm audit --omit=dev --audit-level=high
npm pack --dry-run
```

`release:check` builds the library and Next.js example, checks documentation, generates dependency notices, and installs a tarball into a temporary consumer project. That consumer loads each exported entry point and checks TypeScript declarations without relying on this repository's development dependencies.

Also run the suite against a disposable PostgreSQL instance:

```sh
TEST_DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/safestripe_test npm test
```

The tests truncate SafeStripe tables. Use a dedicated test database with no valuable data. To exercise migrations from the installed tarball as well:

```sh
PACKAGE_DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/safestripe_package_test npm run test:package
```

The package test runs migrations twice to verify packaged SQL resolution and repeatability. It does not truncate that database, but it creates or verifies SafeStripe tables.

### Inspect the archive

Run `npm pack` to create the distributable `.tgz`. The package allowlist includes compiled JavaScript, declarations, source files referenced by source maps, SQL migrations, documentation, and notices. It excludes tests, example secrets, recordings, build caches, and development dependencies.

Inspect the file list and run your repository's secret scanning before publishing. An npm archive is public once published with public access. No install script runs in consumer applications; migration is an explicit action.

### Publish when the package is ready

After selecting the real name and repository, configure the repository's private security reporting channel. Enable account protections and confirm which maintainers can publish.

For a manual first release, authenticate through npm's supported login flow, then publish the inspected package from the project directory:

```sh
npm login
npm publish --access public
```

This is a publishing instruction for the maintainer. The commands are not part of the test suite, and this project has not been published by preparing the files.

For later automated releases, configure [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for the exact repository and workflow. Public packages published from supported public-repository workflows can include provenance. Keep permissions limited and protect the release environment. The included CI validates changes; it does not automatically publish on a push.

See npm's [scoped package publishing guide](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/) for account requirements and the current publishing flow.

## Maintain compatibility

SafeStripe 0.1.0 is an initial release candidate. During 0.x development, document breaking changes in a minor release. Reserve patch releases for compatible fixes. Plan a 1.0 release after the public API and operational requirements have been exercised in the intended deployment.

Keep applied SQL migrations immutable. Add a new numbered file for a schema change. Upgrade Stripe SDK types and webhook API versions as one reviewed compatibility change, with fixtures, handler review, sandbox testing, and a rollback plan. A package update cannot safely reinterpret an old operation's commercial terms.
