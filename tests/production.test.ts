import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import type Stripe from 'stripe';
import {
  SafeStripe,
  PostgresOperations,
  PostgresJobs,
  WebhookWorker,
  effectOnce,
  runWorkerLoop,
  ConcurrencyGate,
  diagnostic,
  type TelemetryEvent,
  scopeKey,
} from '../src/index.js';
import { migrate } from '../src/migrate.js';
import { actor, scope, testDatabase } from './helpers.js';
let h: Awaited<ReturnType<typeof testDatabase>>;
before(async () => {
  h = await testDatabase();
});
after(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.reset();
  await h.db.query('DROP TABLE IF EXISTS sf_migrations');
});

test('installed migration protocol is repeatable and records immutable checksums', async () => {
  assert.deepEqual(await migrate(h.db), ['001_initial.sql']);
  assert.deepEqual(await migrate(h.db), []);
  const result = await h.db.query('SELECT checksum FROM sf_migrations');
  assert.match(String(result.rows[0]!.checksum), /^[a-f0-9]{64}$/);
  await h.db.query("UPDATE sf_migrations SET checksum='modified'");
  await assert.rejects(migrate(h.db), /Unknown or modified/);
});

test('an older package refuses a database with unknown future migrations', async () => {
  await migrate(h.db);
  await h.db.query("INSERT INTO sf_migrations(name,checksum) VALUES('999_future.sql','abc')");
  await assert.rejects(migrate(h.db), /Unknown or modified/);
  assert.equal((await h.db.query('SELECT count(*)::int AS n FROM sf_migrations')).rows[0]!.n, 2);
});

test('two migration runners serialize and apply a file only once', async () => {
  const results = await Promise.all([migrate(h.db), migrate(h.db)]);
  assert.equal(results.flat().length, 1);
});

test('observer failures cannot turn a completed payment into a retry', async () => {
  let calls = 0;
  const sdk = {
    refunds: {
      async create() {
        calls++;
        return { id: 're_1' };
      },
      async retrieve() {
        return { id: 're_1' };
      },
    },
  } as unknown as Stripe;
  const safe = new SafeStripe({
    stripe: sdk,
    scope,
    operations: new PostgresOperations(h.db),
    appOrigin: 'https://shop.example',
    authorize: async () => true,
    observer: async () => {
      throw new Error('metrics offline');
    },
  });
  await safe.createRefund(actor, { paymentIntentId: 'pi_1', amount: 1200 });
  await safe.createRefund(actor, { paymentIntentId: 'pi_1', amount: 1200 });
  await delay(0);
  assert.equal(calls, 1);
  assert.equal((await h.db.query('SELECT state FROM sf_operations')).rows[0]!.state, 'succeeded');
});

test('operation diagnostics retain safe request IDs but omit payloads and raw messages', async () => {
  const events: Readonly<TelemetryEvent>[] = [];
  const sdk = {
    refunds: {
      async create() {
        throw Object.assign(new Error('customer@example.com secret data'), {
          type: 'StripeConnectionError',
          requestId: 'req_abc123',
          raw: { card: 'private' },
        });
      },
    },
  } as unknown as Stripe;
  const safe = new SafeStripe({
    stripe: sdk,
    scope,
    operations: new PostgresOperations(h.db),
    appOrigin: 'https://shop.example',
    authorize: async () => true,
    observer: (event) => {
      events.push(event);
    },
  });
  await assert.rejects(safe.createRefund(actor, { paymentIntentId: 'pi_1', amount: 1200 }), {
    code: 'UPSTREAM_FAILED',
  });
  assert.equal(events[0]!.requestId, 'req_abc123');
  assert.equal(events[0]!.stripeType, 'StripeConnectionError');
  assert.ok(Object.isFrozen(events[0]));
  assert.doesNotMatch(JSON.stringify(events), /customer@|private|pi_1|1200/);
  assert.deepEqual(diagnostic({ requestId: 'req_abc\ninjection', type: 'secret string' }), {
    code: 'UNEXPECTED_FAILURE',
  });
});

test('a failed retrieval replay is sanitized and never resets the completed operation', async () => {
  const sdk = {
    refunds: {
      async create() {
        return { id: 're_1' };
      },
      async retrieve() {
        throw new Error('private upstream detail');
      },
    },
  } as unknown as Stripe;
  const safe = new SafeStripe({
    stripe: sdk,
    scope,
    operations: new PostgresOperations(h.db),
    appOrigin: 'https://shop.example',
    authorize: async () => true,
  });
  await safe.createRefund(actor, { paymentIntentId: 'pi_1', amount: 100 });
  await assert.rejects(safe.createRefund(actor, { paymentIntentId: 'pi_1', amount: 100 }), {
    code: 'UPSTREAM_FAILED',
  });
  assert.equal((await h.db.query('SELECT state FROM sf_operations')).rows[0]!.state, 'succeeded');
});

test('worker abort drains current work and does not start another claim', async () => {
  const stop = new AbortController();
  let calls = 0;
  let completed = 0;
  const releases: (() => void)[] = [];
  const task = runWorkerLoop(
    async () => {
      calls++;
      await new Promise<void>((resolve) => {
        releases.push(resolve);
      });
      completed++;
      return 'done';
    },
    { signal: stop.signal, concurrency: 3 },
  );
  await delay(0);
  assert.equal(calls, 3);
  stop.abort();
  assert.equal(completed, 0);
  releases.forEach((release) => release());
  await task;
  assert.equal(calls, 3);
  assert.equal(completed, 3);
});

test('idle polling aborts promptly and infrastructure failures are observable', async () => {
  const idle = new AbortController();
  const started = performance.now();
  const pending = runWorkerLoop(async () => 'idle', {
    signal: idle.signal,
    pollIntervalMs: 60_000,
    concurrency: 32,
  });
  idle.abort();
  await pending;
  assert.ok(performance.now() - started < 1000);
  const failing = new AbortController();
  const events: Readonly<TelemetryEvent>[] = [];
  await runWorkerLoop(
    async () => {
      throw new Error('private DB details');
    },
    {
      signal: failing.signal,
      observer: (event) => {
        events.push(event);
        failing.abort();
      },
    },
  );
  assert.equal(events[0]!.category, 'worker');
  assert.doesNotMatch(JSON.stringify(events), /private DB/);
});

test('64 distinct events contending on one business effect commit once', async () => {
  const jobs = new PostgresJobs(h.db);
  const scopeId = scopeKey(scope);
  await Promise.all(
    Array.from({ length: 64 }, (_, i) =>
      jobs.enqueue('webhook', scopeId, `evt_stress${i}`, 'paid', { id: `evt_stress${i}` }),
    ),
  );
  const worker = new WebhookWorker(jobs, scopeId, {
    paid: async (_event, tx) => {
      await effectOnce(tx, scopeId, 'tenant:order:fulfill', () =>
        jobs.enqueue('outbox', scopeId, 'receipt', 'receipt', { order: 'one' }, tx).then(() => {}),
      );
    },
  });
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while ((await worker.runOnce()) !== 'idle') {
        /* Drain each lane. */
      }
    }),
  );
  assert.equal(
    (await h.db.query("SELECT count(*)::int AS n FROM sf_jobs WHERE state='done'")).rows[0]!.n,
    64,
  );
  assert.equal((await h.db.query('SELECT count(*)::int AS n FROM sf_effects')).rows[0]!.n, 1);
  assert.equal(
    (await h.db.query("SELECT count(*)::int AS n FROM sf_jobs WHERE queue='outbox'")).rows[0]!.n,
    1,
  );
});

test('worker handler lookup does not execute inherited object properties', async () => {
  const jobs = new PostgresJobs(h.db);
  await jobs.enqueue('webhook', 'scope', 'evt_1', 'toString', {});
  assert.equal(await new WebhookWorker(jobs, 'scope', {}).runOnce(), 'failed');
  assert.equal((await h.db.query('SELECT state FROM sf_jobs')).rows[0]!.state, 'dead');
});

test('bounded gate reports queue pressure and releases slots after errors', async () => {
  const gate = new ConcurrencyGate(1, 1);
  let release!: () => void;
  const first = gate.run(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const second = gate.run(async () => {
    throw new Error('task failure');
  });
  const rejection = assert.rejects(second, /task failure/);
  assert.deepEqual(gate.status, { active: 1, waiting: 1 });
  await assert.rejects(
    gate.run(async () => {}),
    { code: 'BUSY' },
  );
  release();
  await first;
  await rejection;
  assert.deepEqual(gate.status, { active: 0, waiting: 0 });
});

test(
  'exhausted-job cleanup skips a locked row so another job can be claimed',
  {
    skip: !process.env.TEST_DATABASE_URL && 'Requires independent PostgreSQL connections',
  },
  async () => {
    const jobs = new PostgresJobs(h.db, { maxAttempts: 1 });
    await jobs.enqueue('webhook', 'scope', 'evt_locked', 'paid', {});
    await jobs.claim('webhook', 'scope');
    await h.db.query("UPDATE sf_jobs SET lease_until=clock_timestamp()-interval '1 second'");
    await jobs.enqueue('webhook', 'scope', 'evt_ready', 'paid', {});
    const client = await h.db.connect();
    let claimed: ReturnType<typeof jobs.claim> | undefined;
    try {
      await client.query('BEGIN');
      await client.query("SELECT id FROM sf_jobs WHERE id='evt_locked' FOR UPDATE");
      claimed = jobs.claim('webhook', 'scope');
      const result = await Promise.race([claimed, delay(1500).then(() => 'blocked' as const)]);
      assert.notEqual(result, 'blocked');
      assert.equal(typeof result === 'object' ? result?.id : null, 'evt_ready');
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await claimed;
    }
  },
);
