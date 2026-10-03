import assert from 'node:assert/strict';
import { cpus, totalmem, platform, arch } from 'node:os';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fixture, type Backend } from '../tests/chaos/harness.js';
import { WebhookWorker } from '../src/worker.js';
import { digest } from '../src/primitives.js';

const backend: Backend = process.env.BENCH_DATABASE === 'postgres' ? 'postgres' : 'sqlite';
if (backend === 'postgres' && !process.env.CHAOS_DATABASE_URL)
  throw new Error('Set CHAOS_DATABASE_URL to a disposable PostgreSQL database');
function count(name: string, fallback: number, max: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`Invalid ${name}`);
  return value;
}
const events = count('BENCH_EVENTS', 1000, 100000);
const workers = count('BENCH_WORKERS', 4, 32);
const repeats = count('BENCH_REPEATS', 3, 10);
function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? 0;
  return {
    samples: values.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
  };
}
async function run(size: number) {
  const f = await fixture(backend);
  try {
    const version = f.pool
      ? (await f.pool.query('SHOW server_version')).rows[0].server_version
      : process.versions.sqlite;
    const admission: number[] = [],
      completion: number[] = [],
      queueLatency: number[] = [];
    const cpu = process.cpuUsage();
    let peakRssBytes = process.memoryUsage().rss;
    const sampler = setInterval(() => {
      peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    }, 10);
    let inserted = 0,
      workerErrors = 0;
    try {
      const admissionStart = performance.now();
      // Fixed duplicate ratio: ten identical delivery attempts for every event.
      for (let i = 0; i < size; i++) {
        const id = `evt_${i}`;
        for (let j = 0; j < 10; j++) {
          const start = performance.now();
          if (
            await f.jobs.enqueue('webhook', f.scope, id, 'checkout.session.completed', {
              id,
              data: { object: { id: `order-${i}` } },
            })
          )
            inserted++;
          admission.push(performance.now() - start);
        }
      }
      const admissionMs = performance.now() - admissionStart;
      const workerStart = performance.now();
      const worker = () =>
        new WebhookWorker(f.storage.jobs, f.scope, {
          'checkout.session.completed': async (event, tx) => {
            // Record once per successful handler attempt; transaction retries can repeat callbacks.
            if (!('id' in event.data.object)) throw new Error('Missing benchmark object identity');
            const orderId = event.data.object.id;
            await tx.effectOnce(`fulfill:${orderId}`, async (effect) => {
              const prior = await effect.get<{ count: number }>('fulfillments', orderId);
              await effect.set('fulfillments', orderId, { count: (prior?.count ?? 0) + 1 });
              await effect.enqueue(`receipt:${orderId}`, 'receipt', { orderId });
            });
          },
        });
      await Promise.all(
        Array.from({ length: workers }, async () => {
          const w = worker();
          for (;;) {
            const start = performance.now(),
              result = await w.runOnce();
            if (result === 'idle') break;
            completion.push(performance.now() - start);
            if (result === 'failed') workerErrors++;
          }
        }),
      );
      const processingMs = performance.now() - workerStart;
      for (let i = 0; i < size; i++) {
        assert.deepEqual(await f.storage.read(f.scope, 'fulfillments', `order-${i}`), { count: 1 });
        const job = await f.storage.driver.read(digest(['job', 'webhook', f.scope, `evt_${i}`]));
        // Database timestamps measure admission-to-commit age, including backlog build-up.
        queueLatency.push(Number(job!.value.finishedAt) - Number(job!.value.createdAt));
      }
      const counts = await f.counts();
      assert.equal(inserted, size);
      assert.equal(workerErrors, 0);
      assert.deepEqual(counts, { effects: size, outbox: size, done: size });
      const operation = {
        scope: f.scope,
        tenantId: 'benchmark',
        operationId: 'same-business-command',
        kind: 'benchmark',
        fingerprint: digest({ amount: 100 }),
        key: 'benchmark-key',
      };
      const contentionStart = performance.now();
      const claims = await Promise.allSettled(
        Array.from({ length: 20 }, () => f.storage.operations.claim(operation)),
      );
      const owners = claims.filter((r) => r.status === 'fulfilled');
      assert.equal(owners.length, 1);
      for (const r of claims) if (r.status === 'rejected') assert.equal(r.reason.code, 'BUSY');
      const owner = owners[0]!;
      if (owner.status !== 'fulfilled' || owner.value.replay) throw new Error('Expected one owner');
      await f.storage.operations.succeed(operation, owner.value.token, 'resource-benchmark');
      assert.deepEqual(await f.storage.operations.claim(operation), {
        replay: true,
        resourceId: 'resource-benchmark',
      });
      return {
        version,
        events: size,
        deliveryAttempts: size * 10,
        workers,
        admissionMs,
        processingMs,
        admissionAttemptsPerSecond: admission.length / (admissionMs / 1000),
        committedEffectsPerSecond: size / (processingMs / 1000),
        admission: distribution(admission),
        workerIteration: distribution(completion),
        admissionToCommit: distribution(queueLatency),
        contention: {
          claimants: 20,
          owners: 1,
          busy: 19,
          elapsedMs: performance.now() - contentionStart,
        },
        cpuMicroseconds: process.cpuUsage(cpu),
        peakRssBytes,
        workerErrors,
        duplicateEffects: 0,
        counts,
      };
    } finally {
      clearInterval(sampler);
    }
  } finally {
    await f.close();
  }
}
await run(Math.min(events, 100)); // Warm-up is discarded and uses separate records.
const results = [];
for (let i = 0; i < repeats; i++) results.push(await run(events));
const inputs = [
  ...new Set(
    execFileSync(
      'git',
      [
        'ls-files',
        '--cached',
        '--others',
        '--exclude-standard',
        '-z',
        'src',
        'tests/chaos',
        'benchmarks/run.ts',
        'package-lock.json',
      ],
      { encoding: 'utf8' },
    )
      .split('\0')
      .filter(Boolean),
  ),
].sort();
const hash = createHash('sha256');
for (const file of inputs)
  hash
    .update(file + '\0')
    .update(await readFile(file))
    .update('\0');
const report = {
  recordedAt: new Date().toISOString(),
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()),
  sourceSha256: hash.digest('hex'),
  sourceFiles: inputs,
  environment: {
    node: process.version,
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    memoryBytes: totalmem(),
    database: backend,
    connections: backend === 'postgres' ? { workloadPoolMax: 4, schemaAdminPoolMax: 1 } : 1,
    location: process.env.BENCH_LOCATION ?? 'not specified',
  },
  methodology:
    'Closed-loop sequential admission; ten attempts/event; drain a pre-built backlog with same-process worker lanes; nearest-rank percentiles. No HTTP, signature verification, Stripe calls or external outbox delivery. Peak RSS sampled every 10ms.',
  unmeasured: [
    'database CPU/memory',
    'transaction retry counts',
    'process recovery time',
    'multi-host throughput',
    'production network latency',
  ],
  results,
};
await mkdir('benchmarks/results', { recursive: true });
await writeFile(
  `benchmarks/results/${backend}-latest.json`,
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    database: backend,
    runs: results.length,
    eventsPerRun: events,
    duplicateEffects: 0,
    report: `benchmarks/results/${backend}-latest.json`,
  }),
);
