import express from 'express';
import { expressWebhook } from '../../src/adapters/express.js';
import { publicError, runWorkerLoop } from '../../src/index.js';
import { authenticateLocal, getLocalRuntime } from './runtime.js';

const r = await getLocalRuntime();
const app = express();
app.disable('x-powered-by');
app.post(
  '/api/webhooks/stripe',
  express.raw({ type: 'application/json', inflate: false, limit: r.receiver.maxBytes }),
  expressWebhook(r.receiver),
);
app.use(express.json({ limit: '8kb' }));
app.post('/api/checkout', async (req, res) => {
  try {
    authenticateLocal(req.get('authorization'), req.get('origin'));
    if (
      Object.keys(req.body ?? {}).some((key) => key !== 'uiMode') ||
      !['hosted', 'custom'].includes(req.body?.uiMode ?? 'hosted')
    ) {
      res.status(400).json({ error: 'Use uiMode only; order terms belong on the server' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json(await r.createCheckout(req.body?.uiMode ?? 'hosted'));
  } catch (error) {
    const result = publicError(error);
    res.status(result.status).json(result.body);
  }
});
app.get('/api/order', async (req, res) => {
  try {
    authenticateLocal(req.get('authorization'), req.get('origin'));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ state: await r.status() });
  } catch (error) {
    const result = publicError(error);
    res.status(result.status).json(result.body);
  }
});
app.get(['/', '/success', '/cancel'], (_req, res) =>
  res
    .type('text')
    .send(
      'SafeStripe sandbox is running. Create checkout through POST /api/checkout. The /success redirect is not proof of payment. Read the order state through GET /api/order.',
    ),
);
const stop = new AbortController();
const loop = runWorkerLoop(() => r.worker.runOnce(), { signal: stop.signal });
const port = Number(new URL(process.env.APP_ORIGIN!).port || 3000);
const server = app.listen(port, '127.0.0.1', () =>
  console.log(
    `SafeStripe sandbox: http://127.0.0.1:${port} (${r.storage.kind}). Webhook worker is running.`,
  ),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    stop.abort();
    server.close(() => {
      void loop.then(() => r.storage.close());
    });
  });
app.use(((
  error: unknown,
  _req: express.Request,
  res: express.Response,
  _next: express.NextFunction,
) => {
  const status = (error as { status?: number }).status;
  res.status(status === 413 ? 413 : 400).json({ error: 'INVALID_REQUEST' });
}) satisfies express.ErrorRequestHandler);
