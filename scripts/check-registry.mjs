import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = process.cwd();
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const spec = `${manifest.name}@${manifest.version}`;
const registry = 'https://registry.npmjs.org/';
const args = process.argv.slice(2);
assert.ok(
  args.length === 0 || (args.length === 2 && args[0] === '--archive'),
  'Usage: npm run test:registry -- [--archive path/to/reviewed.tgz]',
);
const archive = args[1] ? await readFile(path.resolve(root, args[1])) : undefined;
const expectedIntegrity = archive
  ? 'sha512-' + createHash('sha512').update(archive).digest('base64')
  : undefined;
const directory = await mkdtemp(path.join(tmpdir(), 'safestripe-registry-'));
const cache = path.join(directory, 'cache');
const run = (command, args, cwd = directory) =>
  execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180000,
  });
const npm = (args) => run('npm', [...args, '--registry=' + registry, '--cache=' + cache]);
try {
  const remote = JSON.parse(npm(['view', spec, 'name', 'version', 'dist', '--json']));
  assert.equal(remote.name, manifest.name);
  assert.equal(remote.version, manifest.version);
  if (expectedIntegrity)
    assert.equal(
      remote.dist.integrity,
      expectedIntegrity,
      'Registry archive differs from reviewed candidate',
    );
  await writeFile(
    path.join(directory, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }),
  );
  // Use a normal consumer installation: no lifecycle-script suppression or sibling source checkout.
  npm(['install', '--save-exact', '--no-audit', '--no-fund', spec]);
  const lock = JSON.parse(await readFile(path.join(directory, 'package-lock.json'), 'utf8'));
  const installed = lock.packages['node_modules/' + manifest.name];
  assert.equal(installed.version, manifest.version);
  assert.equal(installed.integrity, remote.dist.integrity);
  assert.equal(installed.resolved, remote.dist.tarball);
  await writeFile(
    path.join(directory, 'core.mjs'),
    `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { SafeStripe, runWorkerLoop, createSafeStripe } from 'safestripe';
import { expressWebhook } from 'safestripe/express';
import { nextWebhook } from 'safestripe/next';
import { migrate } from 'safestripe/migrations';
import { monthlyRecurringAmount } from 'safestripe/metrics';
import { sqliteStorage } from 'safestripe/storage/sqlite';
for (const fn of [SafeStripe, runWorkerLoop, createSafeStripe, expressWebhook, nextWebhook, migrate]) assert.equal(typeof fn, 'function');
assert.equal(monthlyRecurringAmount({ amount: 12000, interval: 'year' }), 1000);
const storage = await sqliteStorage({ filename: ':memory:' });
await storage.transaction('consumer', tx => tx.set('orders', 'one', { persisted: true }));
assert.deepEqual(await storage.read('consumer', 'orders', 'one'), { persisted: true });
await storage.close();
const require = createRequire(import.meta.url);
assert.ok(require.resolve('stripe'));
for (const name of ['pg', 'mongodb', '@google-cloud/firestore', 'express', 'react', 'react-dom', '@stripe/react-stripe-js', '@stripe/stripe-js']) assert.throws(() => require.resolve(name), { code: 'MODULE_NOT_FOUND' });
`,
  );
  run(process.execPath, ['core.mjs']);
  const bin = path.join(directory, 'node_modules', manifest.name, 'dist/cli.js');
  assert.match(run(process.execPath, [bin, '--help']), /safestripe migrate/);
  await writeFile(
    path.join(directory, 'consumer.ts'),
    `
import { SafeStripe, createSafeStripe, type Authorizer, runWorkerLoop } from 'safestripe';
import { expressWebhook } from 'safestripe/express';
import { nextWebhook } from 'safestripe/next';
import { sqliteStorage } from 'safestripe/storage/sqlite';
const policy: Authorizer = async input => input.actor.tenantId.length > 0;
void [SafeStripe, createSafeStripe, runWorkerLoop, expressWebhook, nextWebhook, sqliteStorage, policy];
`,
  );
  run(process.execPath, [
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
  ]);
  npm([
    'install',
    '--save-exact',
    '--no-audit',
    '--no-fund',
    'express@' + manifest.devDependencies.express,
    'pg@' + manifest.devDependencies.pg,
    'mongodb@' + manifest.devDependencies.mongodb,
    '@google-cloud/firestore@' + manifest.devDependencies['@google-cloud/firestore'],
    'react@19',
    'react-dom@19',
    '@stripe/react-stripe-js@' + manifest.devDependencies['@stripe/react-stripe-js'],
    '@stripe/stripe-js@' + manifest.devDependencies['@stripe/stripe-js'],
  ]);
  await writeFile(
    path.join(directory, 'peers.mjs'),
    `
import assert from 'node:assert/strict';
import { postgresStorage } from 'safestripe/storage/postgres';
import { mongoStorage } from 'safestripe/storage/mongodb';
import { firestoreStorage } from 'safestripe/storage/firestore';
import { SafeCheckout } from 'safestripe/react';
import express from 'express';
import { Pool } from 'pg';
import { MongoClient } from 'mongodb';
import { Firestore } from '@google-cloud/firestore';
for (const fn of [postgresStorage, mongoStorage, firestoreStorage, SafeCheckout, express, Pool, MongoClient, Firestore]) assert.equal(typeof fn, 'function');
`,
  );
  run(process.execPath, ['peers.mjs']);
  const peerLock = JSON.parse(await readFile(path.join(directory, 'package-lock.json'), 'utf8'));
  const peerVersions = Object.fromEntries(
    [
      'express',
      'pg',
      'mongodb',
      '@google-cloud/firestore',
      'react',
      'react-dom',
      '@stripe/react-stripe-js',
      '@stripe/stripe-js',
    ].map((name) => [name, peerLock.packages['node_modules/' + name].version]),
  );
  const report = {
    checkedAt: new Date().toISOString(),
    package: manifest.name,
    version: manifest.version,
    verifierCommit: run('git', ['rev-parse', 'HEAD'], root).trim(),
    node: process.version,
    registry,
    tarball: remote.dist.tarball,
    integrity: remote.dist.integrity,
    reviewedArchiveSha256: archive ? createHash('sha256').update(archive).digest('hex') : null,
    stripeSdk: peerLock.packages['node_modules/stripe'].version,
    peerVersions,
    checks: {
      normalRegistryInstall: true,
      registryLockIntegrityMatches: true,
      reviewedArchiveIntegrityMatches: !!archive,
      coreFrameworkMetricsAndMigrationImports: true,
      sqliteTransactionRoundTrip: true,
      stripeSdkIncluded: true,
      unrelatedOptionalPeersAbsentFromCoreInstall: true,
      strictConsumerTypes: true,
      installedCliHelp: true,
      explicitlyInstalledDatabaseAndReactPeerImports: true,
    },
    limits: [
      'Peer imports do not establish database connectivity or production capacity.',
      'Registry installation checks do not verify release signatures, provenance or an independent security review.',
    ],
  };
  await mkdir(path.join(root, 'artifacts'), { recursive: true });
  await writeFile(
    path.join(root, 'artifacts/registry-consumer.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(
    'Registry consumer check failed:',
    error instanceof Error ? error.message.split('\n')[0] : 'unknown failure',
  );
  process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
