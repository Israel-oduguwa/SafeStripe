import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PostgresJobs,
  WebhookWorker,
  effectOnce,
  refreshProjection,
  dispatchOutboxOnce,
  scopeKey,
} from '../src/index.js';
import { event, scope, testDatabase } from './helpers.js';
let harness: Awaited<ReturnType<typeof testDatabase>>;
before(async () => {
  harness = await testDatabase();
});
after(async () => {
  await harness.close();
});
beforeEach(async () => {
  await harness.reset();
});
const scopeId = scopeKey(scope);
async function due() {
  await harness.db.query(
    "UPDATE sf_jobs SET available_at=clock_timestamp()-interval '1 second',lease_until=clock_timestamp()-interval '1 second'",
  );
}

test('duplicate event admission and distinct events produce one business effect', async () => {
  const jobs = new PostgresJobs(harness.db);
  assert.equal(await jobs.enqueue('webhook', scopeId, 'evt_1', 'paid', event()), true);
  assert.equal(await jobs.enqueue('webhook', scopeId, 'evt_1', 'paid', event()), false);
  await jobs.enqueue('webhook', scopeId, 'evt_2', 'paid', event('evt_2'));
  const worker = new WebhookWorker(jobs, scopeId, {
    paid: async (_event, tx) => {
      await effectOnce(tx, scopeId, 'tenant-a:order-1:fulfill', async () => {
        await jobs.enqueue(
          'outbox',
          scopeId,
          'tenant-a:order-1:email',
          'order.fulfilled',
          { orderId: 'order-1' },
          tx,
        );
      });
    },
  });
  await Promise.all([worker.runOnce(), worker.runOnce()]);
  assert.equal((await harness.db.query('SELECT count(*)::int AS n FROM sf_effects')).rows[0]!.n, 1);
  assert.equal(
    (await harness.db.query("SELECT count(*)::int AS n FROM sf_jobs WHERE queue='outbox'")).rows[0]!
      .n,
    1,
  );
  assert.equal(
    (
      await harness.db.query(
        "SELECT count(*)::int AS n FROM sf_jobs WHERE queue='webhook' AND state='done'",
      )
    ).rows[0]!.n,
    2,
  );
});
test('handler rollback removes both the effect guard and partial outbox writes', async () => {
  const jobs = new PostgresJobs(harness.db);
  await jobs.enqueue('webhook', scopeId, 'evt_1', 'paid', event());
  const worker = new WebhookWorker(jobs, scopeId, {
    paid: async (_event, tx) => {
      await effectOnce(tx, scopeId, 'order-1', async () => {
        await jobs.enqueue('outbox', scopeId, 'message-1', 'email', {}, tx);
        throw new Error('downstream local failure');
      });
    },
  });
  assert.equal(await worker.runOnce(), 'failed');
  assert.equal((await harness.db.query('SELECT count(*)::int AS n FROM sf_effects')).rows[0]!.n, 0);
  assert.equal(
    (await harness.db.query("SELECT count(*)::int AS n FROM sf_jobs WHERE queue='outbox'")).rows[0]!
      .n,
    0,
  );
});
test('competing claims never return the same live job', async () => {
  const jobs = new PostgresJobs(harness.db);
  await jobs.enqueue('webhook', scopeId, 'evt_1', 'paid', event());
  const claims = await Promise.all(
    Array.from({ length: 10 }, () => jobs.claim('webhook', scopeId)),
  );
  assert.equal(claims.filter(Boolean).length, 1);
});
test('expired workers cannot commit after a replacement has claimed', async () => {
  const jobs = new PostgresJobs(harness.db);
  await jobs.enqueue('webhook', scopeId, 'evt_1', 'paid', event());
  const first = (await jobs.claim('webhook', scopeId))!;
  await due();
  const second = (await jobs.claim('webhook', scopeId))!;
  let touched = false;
  await assert.rejects(
    jobs.complete(first, async () => {
      touched = true;
    }),
    { code: 'LEASE_LOST' },
  );
  assert.equal(touched, false);
  await jobs.fail(first);
  await jobs.complete(second, async () => {});
  assert.equal(await jobs.claim('webhook', scopeId), null);
});
test('crash on final attempt becomes dead and replay records the operator', async () => {
  const jobs = new PostgresJobs(harness.db, { maxAttempts: 1 });
  await jobs.enqueue('webhook', scopeId, 'evt_1', 'paid', event());
  await jobs.claim('webhook', scopeId);
  await due();
  assert.equal(await jobs.claim('webhook', scopeId), null);
  assert.equal((await harness.db.query('SELECT state FROM sf_jobs')).rows[0]!.state, 'dead');
  await jobs.replayDead(
    'webhook',
    scopeId,
    'evt_1',
    'operator',
    'Handler fixed and business effect reviewed',
  );
  assert.ok(await jobs.claim('webhook', scopeId));
  assert.equal((await harness.db.query('SELECT count(*)::int AS n FROM sf_audit')).rows[0]!.n, 1);
});
test('missing handler is visible as a dead letter instead of silently dropped', async () => {
  const jobs = new PostgresJobs(harness.db);
  await jobs.enqueue('webhook', scopeId, 'evt_1', 'unknown', event());
  assert.equal(await new WebhookWorker(jobs, scopeId, {}).runOnce(), 'failed');
  assert.equal((await harness.db.query('SELECT state FROM sf_jobs')).rows[0]!.state, 'dead');
});
test('out-of-order snapshots refresh from current state instead of reverting', async () => {
  const jobs = new PostgresJobs(harness.db);
  await jobs.enqueue('webhook', scopeId, 'evt_new', 'subscription', { status: 'active' });
  await jobs.enqueue('webhook', scopeId, 'evt_old', 'subscription', { status: 'incomplete' });
  let calls = 0;
  const worker = new WebhookWorker(jobs, scopeId, {
    subscription: async (_event, tx) => {
      await refreshProjection(tx, scopeId, 'sub_1', async () => {
        calls++;
        return { status: 'active' };
      });
    },
  });
  await worker.runOnce();
  await worker.runOnce();
  assert.equal(calls, 2);
  assert.deepEqual(
    (await harness.db.query('SELECT payload FROM sf_projections')).rows[0]!.payload,
    { status: 'active' },
  );
});
test('ambiguous outbox delivery retries with the same recipient idempotency key', async () => {
  const jobs = new PostgresJobs(harness.db);
  const keys: string[] = [];
  await jobs.enqueue('outbox', scopeId, 'order-1:receipt', 'receipt', { order: 'order-1' });
  assert.equal(
    await dispatchOutboxOnce(jobs, scopeId, async (input) => {
      keys.push(input.idempotencyKey);
      throw new Error('response lost after sending');
    }),
    'failed',
  );
  await due();
  assert.equal(
    await dispatchOutboxOnce(jobs, scopeId, async (input) => {
      keys.push(input.idempotencyKey);
    }),
    'done',
  );
  assert.equal(keys[0], keys[1]);
});
