import { SafeStripeError } from './errors.js';
import { integerOption } from './primitives.js';

export interface ExecutionGate {
  run<T>(task: () => Promise<T>): Promise<T>;
}

/** Bounded in-process concurrency. Shared account-wide rate limits still require a distributed policy. */
export class ConcurrencyGate implements ExecutionGate {
  private active = 0;
  private waiting: { resolve: () => void; timer: ReturnType<typeof setTimeout> }[] = [];
  constructor(
    readonly concurrency = 8,
    readonly maxQueue = 32,
    readonly maxWaitMs = 5000,
  ) {
    integerOption(concurrency, 'concurrency', 1, 1000);
    integerOption(maxQueue, 'maxQueue', 0, 10000);
    integerOption(maxWaitMs, 'maxWaitMs', 1, 60000);
  }
  get status(): Readonly<{ active: number; waiting: number }> {
    return Object.freeze({ active: this.active, waiting: this.waiting.length });
  }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) {
      if (this.waiting.length >= this.maxQueue)
        throw new SafeStripeError('BUSY', 'Local Stripe request capacity reached', 503);
      await new Promise<void>((resolve, reject) => {
        const entry = {
          resolve,
          timer: setTimeout(() => {
            const index = this.waiting.indexOf(entry);
            if (index !== -1) this.waiting.splice(index, 1);
            reject(new SafeStripeError('BUSY', 'Local Stripe queue wait expired', 503));
          }, this.maxWaitMs),
        };
        this.waiting.push(entry);
      });
    } else this.active++;
    try {
      return await fn();
    } finally {
      const next = this.waiting.shift();
      if (next) {
        clearTimeout(next.timer);
        next.resolve();
      } else this.active--;
    }
  }
}
