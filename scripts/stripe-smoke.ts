import { randomUUID } from 'node:crypto';
import { createSafeStripe } from '../src/index.js';
import { sqliteStorage } from '../src/storage/sqlite.js';
// Explicit opt-in: creates one temporary sandbox customer, verifies replay, then deletes it.
if (process.env.STRIPE_SMOKE_CONFIRM !== 'sandbox')
  throw new Error('Set STRIPE_SMOKE_CONFIRM=sandbox to opt into the sandbox API test');
const key = process.env.STRIPE_SECRET_KEY ?? '';
if (!/^[sr]k_test_/.test(key)) throw new Error('A sandbox server key is required');
const storage = await sqliteStorage({ filename: './.data/smoke.sqlite' });
let billing: Awaited<ReturnType<typeof createSafeStripe>> | undefined;
let id: string | undefined;
try {
  billing = await createSafeStripe({
    secretKey: key,
    storage,
    accountId: process.env.STRIPE_ACCOUNT_ID || undefined,
    appOrigin: 'https://example.com',
    authorize: async ({ actor, action }) =>
      actor.tenantId === 'smoke' &&
      actor.actorId === 'smoke-runner' &&
      action === 'customer.create',
  });
  const actor = { tenantId: 'smoke', actorId: 'smoke-runner', operationId: randomUUID() };
  id = (await billing.createCustomer(actor, { email: 'safestripe-smoke@example.invalid' })).id;
  const replay = await billing.createCustomer(actor, { email: 'safestripe-smoke@example.invalid' });
  if (replay.id !== id) throw new Error('Idempotent replay returned a different customer');
  console.log('Sandbox customer create and durable replay passed.');
} finally {
  try {
    if (id && billing) await billing.stripe.customers.del(id);
  } finally {
    await storage.close();
  }
}
