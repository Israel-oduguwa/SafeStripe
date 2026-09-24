import express, { type ErrorRequestHandler } from 'express';
import { expressWebhook } from '../../src/adapters/express.js';
import { publicError } from '../../src/index.js';
import { authenticateDemo, createDemoCheckout, getRuntime } from '../shared/runtime.js';

const r = getRuntime();
const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});
// Exact raw bytes must reach signature verification. Do not move express.json above this route.
app.post(
  '/api/webhooks/stripe',
  express.raw({ type: 'application/json', limit: r.receiver.maxBytes, inflate: false }),
  expressWebhook(r.receiver),
);
app.use(express.json({ limit: '8kb' }));
app.post('/api/checkout', async (req, res) => {
  try {
    authenticateDemo(req.get('authorization'), req.get('origin'));
    if (req.body && Object.keys(req.body).length) {
      res.status(400).json({ error: 'THIS_DEMO_ACCEPTS_NO_ORDER_OVERRIDES' });
      return;
    }
    res.status(200).json(await createDemoCheckout());
  } catch (error) {
    const response = publicError(error);
    res.status(response.status).json(response.body);
  }
});
app.get('/success', (_req, res) => {
  res.type('text').send('Payment processing. The verified webhook worker determines fulfillment.');
});
app.get('/cancel', (_req, res) => {
  res.type('text').send('Checkout canceled. No fulfillment was triggered by this page.');
});
const errors: ErrorRequestHandler = (error: { type?: string }, _req, res, _next) => {
  res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: 'INVALID_REQUEST_BODY' });
};
app.use(errors);
const server = app.listen(3000, '127.0.0.1', () => {
  console.log('SafeStripe Express sandbox demo: http://localhost:3000');
});
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => {
    server.close(() => {
      void r.db.end();
    });
  });
