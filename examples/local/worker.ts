import { runWorkerLoop } from '../../src/index.js';
import { getLocalRuntime } from './runtime.js';
const r = await getLocalRuntime();
const stop = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop.abort());
console.log(`SafeStripe webhook worker started (${r.storage.kind})`);
try {
  await runWorkerLoop(() => r.worker.runOnce(), { signal: stop.signal });
} finally {
  await r.storage.close();
}
