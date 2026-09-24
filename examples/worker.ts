import { WebhookWorker, runWorkerLoop } from '../src/index.js';
import { getRuntime } from './shared/runtime.js';
import { buildHandlers } from './shared/handlers.js';
const r = getRuntime();
const observer = (event: unknown) => {
  console.log(JSON.stringify(event));
};
const worker = new WebhookWorker(r.jobs, r.safe.scopeId, buildHandlers(r), { observer });
const stop = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => stop.abort());
try {
  await runWorkerLoop(() => worker.runOnce(), { signal: stop.signal, concurrency: 2, observer });
} finally {
  await r.db.end();
}
