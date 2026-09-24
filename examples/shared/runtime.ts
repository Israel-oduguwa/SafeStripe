import { Pool } from 'pg';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  SafeStripe,
  createStripeClient,
  PostgresOperations,
  PostgresJobs,
  WebhookReceiver,
  SafeStripeError,
  parse,
  stripeId,
  identifier,
} from '../../src/index.js';

export const DEMO_TENANT = 'demo-tenant';
export const DEMO_ACTOR = 'demo-operator';
export const EVENT_TYPES = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.payment_action_required',
];

export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment setting: ${name}`);
  return value;
}
let singleton: ReturnType<typeof createRuntime> | undefined;
export function getRuntime() {
  return (singleton ??= createRuntime());
}
function createRuntime() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Replace demo authentication and order configuration before deployment');
  const token = required('DEMO_TOKEN');
  if (token.length < 32) throw new Error('Use a demo token of at least 32 characters');
  const origin = new URL(required('APP_ORIGIN'));
  if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))
    throw new Error('Demo must run on a loopback origin');
  const scope = {
    platformAccountId: parse(stripeId('acct'), required('STRIPE_ACCOUNT_ID')),
    livemode: false,
  };
  const customerId = parse(stripeId('cus'), required('DEMO_CUSTOMER_ID'));
  const priceId = parse(stripeId('price'), required('DEMO_PRICE_ID'));
  const mode = parse(z.enum(['payment', 'subscription']), process.env.DEMO_PRICE_MODE ?? 'payment');
  const orderId = parse(identifier, required('DEMO_ORDER_ID'));
  const db = new Pool({
    connectionString: required('DATABASE_URL'),
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 15000,
    idle_in_transaction_session_timeout: 20000,
  });
  db.on('error', () => {
    console.error('SafeStripe database connection error');
  });
  const stripe = createStripeClient(required('STRIPE_SECRET_KEY'), false);
  const operations = new PostgresOperations(db);
  const jobs = new PostgresJobs(db);
  const safe = new SafeStripe({
    stripe,
    scope,
    operations,
    appOrigin: origin.origin,
    allowLocalhost: true,
    authorize: async ({ actor, action, resources }) => {
      // Demo only: production resolves authenticated membership, resource ownership and price eligibility in a database.
      return (
        actor.tenantId === DEMO_TENANT &&
        actor.actorId === DEMO_ACTOR &&
        action === 'checkout.create' &&
        actor.operationId === `checkout:${orderId}` &&
        resources.every(
          (r) =>
            (r.kind === 'customer' && r.id === customerId) ||
            (r.kind === 'price' && r.id === priceId),
        )
      );
    },
  });
  const receiver = new WebhookReceiver({
    stripe,
    jobs,
    scope,
    signingSecrets: [required('STRIPE_WEBHOOK_SECRET')],
    eventTypes: EVENT_TYPES,
  });
  return {
    db,
    stripe,
    operations,
    jobs,
    safe,
    receiver,
    customerId,
    priceId,
    orderId,
    mode,
    origin: origin.origin,
    token,
  };
}
export function authenticateDemo(
  header: string | null | undefined,
  origin: string | null | undefined,
) {
  const runtime = getRuntime();
  if (origin && origin !== runtime.origin)
    throw new SafeStripeError('FORBIDDEN', 'Origin is not allowed', 403);
  const expected = Buffer.from(`Bearer ${runtime.token}`);
  const supplied = Buffer.from(header ?? '');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
    throw new SafeStripeError('FORBIDDEN', 'Authentication required', 403);
}
export async function createDemoCheckout() {
  const r = getRuntime();
  // Server configuration owns the order, price, customer and quantity; no browser-supplied prices.
  await r.db.query(
    `INSERT INTO sf_demo_orders(scope,order_id,tenant_id,customer_id,price_id,mode)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
    [r.safe.scopeId, r.orderId, DEMO_TENANT, r.customerId, r.priceId, r.mode],
  );
  const { rows } = await r.db.query('SELECT * FROM sf_demo_orders WHERE scope=$1 AND order_id=$2', [
    r.safe.scopeId,
    r.orderId,
  ]);
  const order = rows[0];
  if (
    !order ||
    order.customer_id !== r.customerId ||
    order.price_id !== r.priceId ||
    order.mode !== r.mode
  )
    throw new SafeStripeError('PAYLOAD_CONFLICT', 'Use a new order ID for a new purchase', 409);
  const session = await r.safe.createCheckout(
    { tenantId: DEMO_TENANT, actorId: DEMO_ACTOR, operationId: `checkout:${r.orderId}` },
    {
      customerId: r.customerId,
      mode: r.mode,
      items: [{ priceId: r.priceId, quantity: 1 }],
      reference: r.orderId,
    },
  );
  const update = await r.db.query(
    `UPDATE sf_demo_orders SET session_id=$3 WHERE scope=$1 AND order_id=$2 AND (session_id IS NULL OR session_id=$3)`,
    [r.safe.scopeId, r.orderId, session.id],
  );
  if (update.rowCount !== 1)
    throw new SafeStripeError('PAYLOAD_CONFLICT', 'Order session binding differs', 409);
  if (session.status === 'expired')
    throw new SafeStripeError(
      'REVIEW_REQUIRED',
      'Session expired; review order before creating a new purchase attempt',
      409,
    );
  return { id: session.id, url: session.url, status: session.status };
}
