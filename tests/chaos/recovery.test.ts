import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, waitUntil, type Backend } from './harness.js';
import { dispatchOutboxOnce } from '../../src/worker.js';
import { digest } from '../../src/primitives.js';
import { migrate } from '../../src/migrate.js';

for (const backend of ['sqlite', 'postgres'] as Backend[]) {
  const options = {
    skip: backend === 'postgres' && !process.env.CHAOS_DATABASE_URL,
    timeout: 60000,
  };
  for (const phase of ['claim', 'transaction'])
    test(`${backend}: SIGKILL at ${phase} recovers one committed effect`, options, async (t) => {
      const f = await fixture(backend);
      t.after(() => f.close());
      await f.jobs.enqueue('webhook', f.scope, 'evt_crash', 'checkout.session.completed', {
        orderId: 'order-1',
      });
      const a = f.spawn(phase);
      t.after(() => a.stop());
      await a.next(phase === 'claim' ? 'claimed' : 'inside-transaction');
      a.process.kill('SIGKILL');
      assert.equal((await a.closed).signal, 'SIGKILL');
      assert.equal(await f.storage.read(f.scope, 'fulfillments', 'order-1'), undefined);
      const before = await f.counts();
      assert.equal(before.effects, 0);
      assert.equal(before.outbox, 0);
      await waitUntil(async () => {
        const row = await f.storage.driver.read(digest(['job', 'webhook', f.scope, 'evt_crash']));
        return !!row && row.dueAt <= (await f.storage.driver.now());
      });
      assert.equal((await f.drain(1))[0]!.code, 0);
      assert.deepEqual(await f.storage.read(f.scope, 'fulfillments', 'order-1'), { count: 1 });
      assert.deepEqual(await f.counts(), { effects: 1, outbox: 1, done: 1 });
    });
  test(
    `${backend}: accepted outbox delivery survives sender SIGKILL without duplicate receiver effect`,
    options,
    async (t) => {
      const f = await fixture(backend);
      t.after(() => f.close());
      await f.storage.transaction(f.scope, (tx) =>
        tx.enqueue('receipt:order-1', 'receipt', { orderId: 'order-1' }),
      );
      const a = f.spawn('outbox');
      t.after(() => a.stop());
      await a.next('receiver-accepted');
      a.process.kill('SIGKILL');
      await a.closed;
      await waitUntil(async () => {
        const row = await f.storage.driver.read(
          digest(['job', 'outbox', f.scope, 'receipt:order-1']),
        );
        return !!row && row.dueAt <= (await f.storage.driver.now());
      });
      let duplicateDelivery = false;
      assert.equal(
        await dispatchOutboxOnce(f.jobs, f.scope, async (message) => {
          await f.storage.transaction(f.scope, async (tx) => {
            const receipt = await tx.get<{ count: number }>('deliveries', message.idempotencyKey);
            duplicateDelivery = !!receipt;
            assert.deepEqual(receipt, { count: 1 });
          });
        }),
        'done',
      );
      assert.equal(duplicateDelivery, true);
      assert.equal((await f.jobs.inspect('outbox', f.scope, 'receipt:order-1'))?.state, 'done');
    },
  );
  test(`${backend}: SIGTERM drains its in-flight transaction`, options, async (t) => {
    const f = await fixture(backend);
    t.after(() => f.close());
    await f.jobs.enqueue('webhook', f.scope, 'evt_term', 'checkout.session.completed', {});
    const a = f.spawn('graceful');
    t.after(() => a.stop());
    await a.next('inside-transaction');
    a.process.kill('SIGTERM');
    await a.next('stopping');
    a.process.send({ release: true });
    await a.next('done');
    assert.equal((await a.closed).code, 0);
    assert.deepEqual(await f.counts(), { effects: 1, outbox: 1, done: 1 });
  });
  test(
    `${backend}: 100 repeated admissions and distinct events preserve one business effect`,
    options,
    async (t) => {
      const f = await fixture(backend);
      t.after(() => f.close());
      const admitted = await Promise.all(
        Array.from({ length: 100 }, () =>
          f.jobs.enqueue('webhook', f.scope, 'evt_repeat', 'checkout.session.completed', {
            orderId: 'order-1',
          }),
        ),
      );
      assert.equal(admitted.filter(Boolean).length, 1);
      for (let i = 0; i < 20; i++)
        await f.jobs.enqueue('webhook', f.scope, `evt_${i}`, 'checkout.session.completed', {
          orderId: 'order-1',
        });
      // Multiple SQLite writers are intentionally unsupported; exercise multi-process contention on PostgreSQL.
      for (const worker of await f.drain(21, backend === 'postgres' ? 20 : 1))
        assert.equal(worker.code, 0);
      assert.deepEqual(await f.storage.read(f.scope, 'fulfillments', 'order-1'), { count: 1 });
      assert.deepEqual(await f.counts(), { effects: 1, outbox: 1, done: 21 });
    },
  );
  test(`${backend}: expired owner cannot commit after reassignment`, options, async (t) => {
    const f = await fixture(backend);
    t.after(() => f.close());
    await f.jobs.enqueue('webhook', f.scope, 'evt_stale', 'checkout.session.completed', {});
    const a = (await f.jobs.claim('webhook', f.scope))!;
    let b: typeof a | null = null;
    await waitUntil(async () => !!(b = await f.jobs.claim('webhook', f.scope)));
    await assert.rejects(
      f.jobs.complete(a, (tx) => tx.set('fulfillments', 'order-1', { count: 99 })),
      { code: 'LEASE_LOST' },
    );
    await f.jobs.complete(b!, (tx) => tx.set('fulfillments', 'order-1', { count: 1 }));
    assert.deepEqual(await f.storage.read(f.scope, 'fulfillments', 'order-1'), { count: 1 });
  });
  if (backend === 'postgres')
    test(
      'postgres: terminated transaction connection rolls back and replacement worker recovers',
      options,
      async (t) => {
        const f = await fixture(backend);
        t.after(() => f.close());
        await f.jobs.enqueue(
          'webhook',
          f.scope,
          'evt_disconnect',
          'checkout.session.completed',
          {},
        );
        const a = f.spawn('connection-loss');
        t.after(() => a.stop());
        await a.next('inside-transaction');
        const connections = await f.pool!.query(
          'SELECT pid, state FROM pg_stat_activity WHERE application_name=$1',
          [f.config.applicationName],
        );
        assert.equal(connections.rowCount, 1);
        assert.equal(connections.rows[0].state, 'idle in transaction');
        // Terminate only this fixture's worker connection, never the database
        // service or a connection belonging to another application/test.
        const terminated = await f.pool!.query(
          'SELECT pg_terminate_backend(pid) AS terminated FROM pg_stat_activity WHERE pid=$1 AND application_name=$2',
          [connections.rows[0].pid, f.config.applicationName],
        );
        assert.equal(terminated.rows[0].terminated, true);
        await a.next('database-disconnected');
        assert.deepEqual(await f.counts(), { effects: 0, outbox: 0, done: 0 });
        assert.equal(await f.storage.read(f.scope, 'fulfillments', 'order-1'), undefined);
        a.process.send({ release: true });
        assert.equal((await a.next('iteration')).result, 'failed');
        await a.next('done');
        assert.equal((await a.closed).code, 0);
        await waitUntil(async () => {
          const row = await f.storage.driver.read(
            digest(['job', 'webhook', f.scope, 'evt_disconnect']),
          );
          return !!row && row.dueAt <= (await f.storage.driver.now());
        });
        assert.equal((await f.drain(1))[0]!.code, 0);
        assert.deepEqual(await f.storage.read(f.scope, 'fulfillments', 'order-1'), { count: 1 });
        assert.deepEqual(await f.counts(), { effects: 1, outbox: 1, done: 1 });
      },
    );
  if (backend === 'postgres')
    test(
      'postgres: concurrent migration runners and reconnect retain committed work',
      options,
      async (t) => {
        const f = await fixture(backend);
        t.after(() => f.close());
        assert.deepEqual(
          await Promise.all([migrate(f.pool!), migrate(f.pool!), migrate(f.pool!)]),
          [[], [], []],
        );
        await f.storage.transaction(f.scope, (tx) =>
          tx.set('fulfillments', 'order-1', { count: 1 }),
        );
        assert.equal((await f.drain(0))[0]!.code, 0);
        assert.deepEqual(await f.storage.read(f.scope, 'fulfillments', 'order-1'), { count: 1 });
      },
    );
}
