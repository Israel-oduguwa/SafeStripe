import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, child, waitUntil, type Backend } from './harness.js';
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
      const a = child(f.config, phase);
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
      const b = child(f.config, 'drain');
      t.after(() => b.stop());
      await b.next('done');
      assert.equal((await b.closed).code, 0);
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
      const a = child(f.config, 'outbox');
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
    const a = child(f.config, 'graceful');
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
      const workers = Array.from({ length: backend === 'postgres' ? 20 : 1 }, () =>
        child(f.config, 'drain'),
      );
      t.after(async () => {
        await Promise.all(workers.map((w) => w.stop()));
      });
      await Promise.all(
        workers.map(async (w) => {
          await w.next('done');
          assert.equal((await w.closed).code, 0);
        }),
      );
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
        const a = child(f.config, 'drain');
        t.after(() => a.stop());
        await a.next('done');
        await a.closed;
        assert.deepEqual(await f.storage.read(f.scope, 'fulfillments', 'order-1'), { count: 1 });
      },
    );
}
