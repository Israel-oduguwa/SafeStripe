import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), 'safestripe-consumer-'));
const meta = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const run = (command, args, cwd = root) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
try {
  const [packed] = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', directory]));
  const files = new Set(packed.files.map((file) => file.path));
  for (const name of [
    'dist/index.js',
    'dist/index.d.ts',
    'dist/adapters/express.js',
    'dist/adapters/next.js',
    'dist/cli.js',
    'dist/storage/sqlite.js',
    'dist/storage/postgres.js',
    'dist/storage/mongodb.js',
    'dist/storage/firestore.js',
    'dist/react/index.js',
    'migrations/002_portable_storage.sql',
    'migrations/001_initial.sql',
    'LICENSE',
    'NOTICE',
    'THIRD_PARTY_NOTICES.md',
  ])
    assert.ok(files.has(name), `Missing package file: ${name}`);
  for (const name of files)
    assert.ok(
      !/(^|\/)(\.env[^/]*|node_modules|tests|artifacts|recordings|\.next)(\/|$)/.test(name),
      `Unwanted package file: ${name}`,
    );
  const consumer = path.join(directory, 'consumer');
  await mkdir(consumer);
  await writeFile(
    path.join(consumer, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }),
  );
  run(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--omit=dev',
      '--no-audit',
      '--no-fund',
      path.join(directory, packed.filename),
    ],
    consumer,
  );
  await writeFile(
    path.join(consumer, 'smoke.mjs'),
    `import assert from 'node:assert/strict';
const core = await import(${JSON.stringify(meta.name)});
const express = await import(${JSON.stringify(meta.name + '/express')});
const next = await import(${JSON.stringify(meta.name + '/next')});
const migrations = await import(${JSON.stringify(meta.name + '/migrations')});
assert.equal(typeof core.SafeStripe, 'function');
assert.equal(typeof core.SafeStripe.prototype.createMultiItemSubscription, 'function');
const metrics = await import('${meta.name}/metrics');
assert.equal(metrics.monthlyRecurringAmount({amount:12000,interval:'year'}),1000);
assert.equal(typeof metrics.calculateRevenueMetrics,'function');
assert.equal(typeof express.expressWebhook, 'function');
assert.equal(typeof next.nextWebhook, 'function');
assert.equal(typeof migrations.migrate, 'function');
assert.equal(typeof core.runWorkerLoop, 'function');
const { sqliteStorage } = await import('${meta.name}/storage/sqlite');
const storage = await sqliteStorage({filename:':memory:'});
await storage.transaction('consumer', tx => tx.set('orders','one',{persisted:true}));
assert.deepEqual(await storage.read('consumer','orders','one'),{persisted:true});
await storage.close();
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
assert.ok(require.resolve('stripe'));
for (const name of ['pg','react','react-dom','@stripe/react-stripe-js','@stripe/stripe-js'])
  assert.throws(() => require.resolve(name), {code:'MODULE_NOT_FOUND'});
assert.throws(() => require.resolve('mongodb'), {code:'MODULE_NOT_FOUND'});
assert.throws(() => require.resolve('@google-cloud/firestore'), {code:'MODULE_NOT_FOUND'});

`,
  );
  run(process.execPath, ['smoke.mjs'], consumer);
  await writeFile(
    path.join(consumer, 'consumer.ts'),
    `import { SafeStripe, type Authorizer, type Database, runWorkerLoop, ConcurrencyGate } from '${meta.name}';
import { expressWebhook } from '${meta.name}/express';
import { nextWebhook } from '${meta.name}/next';
import { migrate } from '${meta.name}/migrations';
import { sqliteStorage } from '${meta.name}/storage/sqlite';
import { postgresStorage } from '${meta.name}/storage/postgres';
void [sqliteStorage,postgresStorage];
const policy: Authorizer = async input => input.actor.tenantId.length > 0;
const gate = new ConcurrencyGate();
void [SafeStripe, policy, gate, migrate, expressWebhook, nextWebhook, runWorkerLoop];
const database = null as unknown as Database; void database;
import { calculateRevenueMetrics } from '${meta.name}/metrics';
import type { SubscriptionPlan, ContractSchedule } from '${meta.name}';
declare const billing: SafeStripe;
const plan: SubscriptionPlan = { customerId:'cus_example', items:[{priceId:'price_example'}] };
void billing.createMultiItemSubscription({tenantId:'tenant',actorId:'user',operationId:'signup'},plan);
void calculateRevenueMetrics({currency:'usd',start:[],end:[]});
declare const contract: ContractSchedule; void contract;
`,
  );
  run(
    process.execPath,
    [
      path.join(root, 'node_modules/typescript/bin/tsc'),
      '--noEmit',
      '--strict',
      '--target',
      'ES2022',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      'consumer.ts',
    ],
    consumer,
  );
  const bin = path.join(consumer, 'node_modules', ...meta.name.split('/'), 'dist/cli.js');
  assert.match(run(process.execPath, [bin, '--help'], consumer), /safestripe migrate/);
  run(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      'pg@' + meta.devDependencies.pg,
      'react@19',
      'react-dom@19',
      '@stripe/react-stripe-js@' + meta.devDependencies['@stripe/react-stripe-js'],
      '@stripe/stripe-js@' + meta.devDependencies['@stripe/stripe-js'],
    ],
    consumer,
  );
  await writeFile(
    path.join(consumer, 'optional.mjs'),
    `
import assert from 'node:assert/strict';
import { SafeCheckout } from '${meta.name}/react';
import { postgresStorage } from '${meta.name}/storage/postgres';
import { Pool } from 'pg';
assert.equal(typeof SafeCheckout, 'function');
assert.equal(typeof postgresStorage, 'function');
assert.equal(typeof Pool, 'function');
`,
  );
  run(process.execPath, ['optional.mjs'], consumer);
  // A real database can additionally prove that packaged SQL files resolve at runtime.
  if (process.env.PACKAGE_DATABASE_URL) {
    const env = { ...process.env, DATABASE_URL: process.env.PACKAGE_DATABASE_URL };
    const first = execFileSync(process.execPath, [bin, 'migrate'], {
      cwd: consumer,
      env,
      encoding: 'utf8',
    });
    const second = execFileSync(process.execPath, [bin, 'migrate'], {
      cwd: consumer,
      env,
      encoding: 'utf8',
    });
    assert.match(first, /Applied:|up to date/);
    assert.match(second, /up to date/);
  }
  console.log(
    `Package verified: ${packed.files.length} files; clean install; core/adapters/migrations imports; strict consumer types; CLI${process.env.PACKAGE_DATABASE_URL ? '; real database migration replay' : ''}.`,
  );
} catch (error) {
  // npm output can contain registry configuration. Keep failure output limited to a useful message.
  if (error?.stdout) process.stderr.write(String(error.stdout));
  if (error?.stderr) process.stderr.write(String(error.stderr));
  throw error;
} finally {
  await rm(directory, { recursive: true, force: true });
}
