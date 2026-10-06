import { runWorkerLoop, type WorkResult } from '../src/worker.js';

/** Use the production retry loop and stop on committed work, not a transient empty claim. */
export async function drainBacklog(
  runOnce: () => Promise<WorkResult>,
  expected: number,
  options: { concurrency: number; deadlineMs: number },
) {
  const stop = new AbortController();
  let completed = 0,
    handlerFailures = 0,
    claimFailures = 0,
    deadlineExceeded = false;
  const iterationMs: number[] = [];
  const deadline = setTimeout(() => {
    deadlineExceeded = true;
    stop.abort();
  }, options.deadlineMs);
  try {
    await runWorkerLoop(
      async () => {
        const started = performance.now();
        const result = await runOnce();
        if (result !== 'idle') iterationMs.push(performance.now() - started);
        if (result === 'failed') handlerFailures++;
        if (result === 'done' && ++completed === expected) stop.abort();
        return result;
      },
      {
        signal: stop.signal,
        concurrency: options.concurrency,
        pollIntervalMs: 10,
        errorIntervalMs: 20,
        observer: () => {
          claimFailures++;
        },
      },
    );
    return { completed, handlerFailures, claimFailures, deadlineExceeded, iterationMs };
  } finally {
    clearTimeout(deadline);
  }
}
