import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { createStripeClient, PostgresOperations, SafeStripe } from '../src/index.js';
// Explicit opt-in sandbox smoke test. Creates a temporary customer and removes it afterward.
if (process.env.STRIPE_SMOKE_CONFIRM !== 'sandbox')
  throw new Error('Set STRIPE_SMOKE_CONFIRM=sandbox to opt into the sandbox API test');
const key = process.env.STRIPE_SECRET_KEY ?? '';
const account = process.env.STRIPE_ACCOUNT_ID;
if (!account || !process.env.DATABASE_URL)
  throw new Error('Configure STRIPE_ACCOUNT_ID and DATABASE_URL');
const stripe = createStripeClient(key, false);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const safe = new SafeStripe({
  stripe,
  scope: { platformAccountId: account, livemode: false },
  operations: new PostgresOperations(pool),
  authorize: async ({ actor, action }) =>
    actor.tenantId === 'smoke' && action === 'customer.create',
  appOrigin: 'https://example.com',
});
let id: string | undefined;
try {
  const actor = { tenantId: 'smoke', actorId: 'smoke-runner', operationId: randomUUID() };
  id = (await safe.createCustomer(actor, { email: 'safestripe-smoke@example.invalid' })).id;
  const replay = await safe.createCustomer(actor, { email: 'safestripe-smoke@example.invalid' });
  if (replay.id !== id) throw new Error('Idempotent replay returned a different customer');
  console.log('Sandbox customer create and durable replay passed.');
} finally {
  try {
    if (id) await stripe.customers.del(id);
  } finally {
    await pool.end();
  }
}
