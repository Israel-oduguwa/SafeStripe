import type Stripe from 'stripe';
import type { Sql } from './database.js';
import { PostgresJobs, outboxDeliveryKey } from './jobs.js';
import { integerOption } from './primitives.js';
import { observe, diagnostic, type Observer } from './telemetry.js';

export type WorkResult = 'idle' | 'done' | 'failed';
export type EventHandler = (event: Stripe.Event, tx: Sql) => Promise<void>;
export class WebhookWorker {
  private readonly handlers: Readonly<Record<string, EventHandler>>;
  constructor(
    private readonly jobs: PostgresJobs,
    private readonly scope: string,
    handlers: Record<string, EventHandler>,
    private readonly options: { observer?: Observer } = {},
  ) {
    this.handlers = Object.freeze({ ...handlers });
  }
  async runOnce(): Promise<WorkResult> {
    const job = await this.jobs.claim('webhook', this.scope);
    if (!job) return 'idle';
    const started = performance.now();
    const report = (outcome: 'succeeded' | 'failed', details = {}) =>
      observe(this.options.observer, {
        category: 'job',
        action: job.type,
        outcome,
        attempt: job.attempts,
        durationMs: performance.now() - started,
        ...details,
      });
    const handler = Object.hasOwn(this.handlers, job.type) ? this.handlers[job.type] : undefined;
    if (!handler) {
      await this.jobs.fail(job, true);
      report('failed', { code: 'HANDLER_MISSING' });
      return 'failed';
    }
    try {
      await this.jobs.complete(job, (tx) => handler(job.payload as Stripe.Event, tx));
      report('succeeded');
      return 'done';
    } catch (error) {
      await this.jobs.fail(job);
      report('failed', diagnostic(error));
      return 'failed';
    }
  }
}

/** Delivery is at least once. The remote recipient MUST deduplicate the supplied key. */
export async function dispatchOutboxOnce(
  jobs: PostgresJobs,
  scope: string,
  deliver: (message: { type: string; payload: unknown; idempotencyKey: string }) => Promise<void>,
  options: { observer?: Observer } = {},
): Promise<WorkResult> {
  const job = await jobs.claim('outbox', scope);
  if (!job) return 'idle';
  const started = performance.now();
  try {
    await deliver({ type: job.type, payload: job.payload, idempotencyKey: outboxDeliveryKey(job) });
    await jobs.complete(job, async () => {});
    observe(options.observer, {
      category: 'job',
      action: job.type,
      outcome: 'succeeded',
      attempt: job.attempts,
      durationMs: performance.now() - started,
    });
    return 'done';
  } catch (error) {
    await jobs.fail(job);
    observe(options.observer, {
      category: 'job',
      action: job.type,
      outcome: 'failed',
      attempt: job.attempts,
      durationMs: performance.now() - started,
      ...diagnostic(error),
    });
    return 'failed';
  }
}

export interface WorkerLoopOptions {
  signal: AbortSignal;
  concurrency?: number;
  pollIntervalMs?: number;
  errorIntervalMs?: number;
  observer?: Observer;
}

/** Stops claiming after abort and awaits in-flight tasks; it never abandons a transaction. */
export async function runWorkerLoop(
  runOnce: () => Promise<WorkResult>,
  options: WorkerLoopOptions,
): Promise<void> {
  const concurrency = integerOption(options.concurrency ?? 1, 'concurrency', 1, 64);
  const pollMs = integerOption(options.pollIntervalMs ?? 500, 'pollIntervalMs', 10, 60_000);
  const errorMs = integerOption(options.errorIntervalMs ?? 1000, 'errorIntervalMs', 10, 60_000);
  const waiters = new Set<() => void>();
  const wake = () => {
    for (const finish of [...waiters]) finish();
  };
  options.signal.addEventListener('abort', wake, { once: true });
  const pause = (ms: number) =>
    new Promise<void>((resolve) => {
      if (options.signal.aborted) {
        resolve();
        return;
      }
      const finish = () => {
        clearTimeout(timer);
        waiters.delete(finish);
        resolve();
      };
      const timer = setTimeout(finish, ms * (0.8 + Math.random() * 0.4));
      waiters.add(finish);
    });
  const lane = async () => {
    while (!options.signal.aborted) {
      const started = performance.now();
      try {
        const result = await runOnce();
        if (result !== 'done') await pause(result === 'idle' ? pollMs : errorMs);
      } catch (error) {
        observe(options.observer, {
          category: 'worker',
          action: 'poll',
          outcome: 'failed',
          durationMs: performance.now() - started,
          ...diagnostic(error),
        });
        await pause(errorMs);
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: concurrency }, () => lane()));
  } finally {
    options.signal.removeEventListener('abort', wake);
    wake();
  }
}
