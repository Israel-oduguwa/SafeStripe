import { Pool } from 'pg';
import { DocumentJobs } from '../../src/storage/store.js';
import { sqliteStorage } from '../../src/storage/sqlite.js';
import { postgresStorage } from '../../src/storage/postgres.js';
import { WebhookWorker, dispatchOutboxOnce, runWorkerLoop } from '../../src/worker.js';
import type { BillingTransaction } from '../../src/storage/contracts.js';

process.once('message', async (message: any) => {
  let pool: Pool | undefined;
  try {
    if (message.backend === 'postgres')
      pool = new Pool({
        connectionString: process.env.CHAOS_DATABASE_URL,
        options: `-c search_path=${message.schema}`,
        max: 1,
      });
    const storage = pool
      ? await postgresStorage({ db: pool })
      : await sqliteStorage({ filename: message.filename });
    const jobs = new DocumentJobs(storage.driver, { leaseSeconds: 1, maxAttempts: 10 });
    const checkpoint = async (name: string) => {
      process.send!({ type: name });
      await new Promise<void>((resolve) => process.once('message', () => resolve()));
    };
    const fulfill = async (_event: unknown, tx: BillingTransaction) => {
      await tx.effectOnce('fulfill:order-1', async (effect) => {
        const previous = await effect.get<{ count: number }>('fulfillments', 'order-1');
        await effect.set('fulfillments', 'order-1', { count: (previous?.count ?? 0) + 1 });
        await effect.enqueue('receipt:order-1', 'receipt', { orderId: 'order-1' });
        if (message.mode === 'transaction' || message.mode === 'graceful')
          await checkpoint('inside-transaction');
      });
    };
    if (message.mode === 'claim') {
      const job = await jobs.claim('webhook', message.scope);
      if (!job) throw new Error('Missing job');
      await checkpoint('claimed');
    } else if (message.mode === 'outbox') {
      await dispatchOutboxOnce(jobs, message.scope, async (delivery) => {
        // A separate receiver transaction models durable acceptance before its response is lost.
        await storage.transaction(message.scope, async (tx) => {
          const previous = await tx.get<{ count: number }>('deliveries', delivery.idempotencyKey);
          if (!previous) await tx.set('deliveries', delivery.idempotencyKey, { count: 1 });
        });
        await checkpoint('receiver-accepted');
      });
    } else if (message.mode === 'graceful') {
      const abort = new AbortController();
      process.once('SIGTERM', () => {
        abort.abort();
        process.send!({ type: 'stopping' });
      });
      await runWorkerLoop(
        () =>
          new WebhookWorker(jobs, message.scope, {
            'checkout.session.completed': fulfill,
          }).runOnce(),
        { signal: abort.signal, pollIntervalMs: 20 },
      );
    } else {
      const worker = new WebhookWorker(jobs, message.scope, {
        'checkout.session.completed': fulfill,
      });
      if (message.mode === 'transaction') await worker.runOnce();
      else {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          const result = await worker.runOnce();
          if (result === 'failed') throw new Error('Worker failure');
          if (result === 'idle') break;
        }
      }
    }
    await storage.close();
    await pool?.end();
    process.send!({ type: 'done' });
    process.disconnect();
  } catch {
    process.send?.({ type: 'failed' });
    await pool?.end();
    process.exitCode = 1;
    process.disconnect?.();
  }
});
