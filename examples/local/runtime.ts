import { timingSafeEqual } from 'node:crypto';
import type Stripe from 'stripe';
import {
  createSafeStripe,
  SafeStripeError,
  identifier,
  parse,
  stripeId,
  type BillingStorage,
  type BillingTransaction,
  type EventHandler,
} from '../../src/index.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment setting: ${name}`);
  return value;
}
async function openStorage(): Promise<BillingStorage> {
  switch (process.env.BILLING_DATABASE ?? 'sqlite') {
    case 'sqlite': {
      const { sqliteStorage } = await import('../../src/storage/sqlite.js');
      return sqliteStorage({ filename: process.env.SQLITE_PATH ?? './.data/billing.sqlite' });
    }
    case 'postgres': {
      const { Pool } = await import('pg');
      const { postgresStorage } = await import('../../src/storage/postgres.js');
      const db = new Pool({
        connectionString: required('DATABASE_URL'),
        max: 5,
        connectionTimeoutMillis: 5000,
        statement_timeout: 15000,
        idle_in_transaction_session_timeout: 20000,
      });
      db.on('error', () => console.error('Billing database connection interrupted'));
      const storage = await postgresStorage({ db, migrate: true });
      const close = storage.close.bind(storage);
      storage.close = async () => {
        await close();
        await db.end();
      };
      return storage;
    }
    case 'mongodb': {
      const { MongoClient } = await import('mongodb');
      const { mongoStorage } = await import('../../src/storage/mongodb.js');
      const client = new MongoClient(required('MONGODB_URI'), {
        maxPoolSize: 5,
        serverSelectionTimeoutMS: 5000,
      });
      await client.connect();
      const storage = await mongoStorage({
        client,
        database: process.env.MONGODB_DATABASE ?? 'safestripe_sandbox',
      });
      storage.close = () => client.close();
      return storage;
    }
    case 'firestore': {
      const { Firestore } = await import('@google-cloud/firestore');
      const { firestoreStorage } = await import('../../src/storage/firestore.js');
      const db = new Firestore({ projectId: required('GOOGLE_CLOUD_PROJECT') });
      const storage = await firestoreStorage({ db });
      storage.close = () => db.terminate();
      return storage;
    }
    default:
      throw new Error('BILLING_DATABASE must be sqlite, postgres, mongodb or firestore');
  }
}
let singleton: ReturnType<typeof createRuntime> | undefined;
export function getLocalRuntime() {
  return (singleton ??= createRuntime().catch((error) => {
    singleton = undefined;
    throw error;
  }));
}
export function authenticateLocal(
  authorization: string | null | undefined,
  origin: string | null | undefined,
) {
  const expected = Buffer.from(`Bearer ${required('DEMO_TOKEN')}`);
  const actual = Buffer.from(authorization ?? '');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new SafeStripeError('FORBIDDEN', 'Sign in to the sandbox demo', 403);
  if (origin && origin !== new URL(required('APP_ORIGIN')).origin)
    throw new SafeStripeError('FORBIDDEN', 'Origin is not allowed', 403);
}
interface Order {
  id: string;
  tenantId: string;
  customerId: string;
  priceId: string;
  sessionId: string;
  state: string;
}
async function createRuntime() {
  if (process.env.NODE_ENV === 'production')
    throw new Error(
      'This learning app uses local demo authentication. Connect your own session and order policy before deployment.',
    );
  if (required('DEMO_TOKEN').length < 32)
    throw new Error('DEMO_TOKEN must contain at least 32 characters');
  const origin = new URL(required('APP_ORIGIN'));
  if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))
    throw new Error('The learning app must run on a loopback origin');
  const secretKey = required('STRIPE_SECRET_KEY');
  if (!/^[sr]k_test_/.test(secretKey)) throw new Error('The learning app requires a sandbox key');
  const customerId = parse(stripeId('cus'), required('DEMO_CUSTOMER_ID'));
  const priceId = parse(stripeId('price'), required('DEMO_PRICE_ID'));
  const orderId = parse(identifier, process.env.DEMO_ORDER_ID ?? 'demo-order-001');
  const storage = await openStorage();
  try {
    const billing = await createSafeStripe({
      secretKey,
      storage,
      accountId: process.env.STRIPE_ACCOUNT_ID || undefined,
      appOrigin: origin.origin,
      allowLocalhost: true,
      authorize: async ({ actor, action, resources }) =>
        actor.tenantId === 'demo-tenant' &&
        actor.actorId === 'demo-user' &&
        actor.operationId === `checkout:${orderId}` &&
        action === 'checkout.create' &&
        resources.every((resource) =>
          resource.kind === 'customer'
            ? resource.id === customerId
            : resource.kind === 'price' && resource.id === priceId,
        ),
    });
    const checkout: EventHandler<BillingTransaction> = async (event, tx) => {
      const id = (event.data.object as Stripe.Checkout.Session).id;
      const order = await tx.get<Order>('sessions', id);
      if (!order) throw new Error('Checkout result is not bound yet; retry or reconcile');
      // Read the remote state while holding a transaction dependency on this order.
      const options = { ...billing.requestOptions(), timeout: 8000, maxNetworkRetries: 0 };
      const session = await billing.stripe.checkout.sessions.retrieve(id, {}, options);
      const customer =
        typeof session.customer === 'string' ? session.customer : session.customer?.id;
      if (
        customer !== order.customerId ||
        session.client_reference_id !== order.id ||
        session.mode !== 'payment'
      )
        throw new Error('Session does not match the stored order');
      if (session.status !== 'complete' || session.payment_status !== 'paid') return;
      const lines = await billing.stripe.checkout.sessions.listLineItems(
        id,
        { limit: 100 },
        options,
      );
      if (
        lines.has_more ||
        lines.data.length !== 1 ||
        lines.data[0]?.price?.id !== order.priceId ||
        lines.data[0]?.quantity !== 1
      )
        throw new Error('Payment terms do not match the stored order');
      await tx.effectOnce(`fulfill:${order.tenantId}:${order.id}`, async (inner) => {
        await inner.set('sessions', id, { ...order, state: 'fulfilled' });
        await inner.set('orders', order.id, { ...order, state: 'fulfilled' });
        await inner.enqueue(`receipt:${order.tenantId}:${order.id}`, 'order.confirmed', {
          orderId: order.id,
        });
      });
    };
    const handlers = {
      'checkout.session.completed': checkout,
      'checkout.session.async_payment_succeeded': checkout,
    };
    const receiver = billing.webhooks({
      signingSecrets: [required('STRIPE_WEBHOOK_SECRET')],
      eventTypes: Object.keys(handlers),
    });
    const worker = billing.worker(handlers);
    return {
      billing,
      storage,
      receiver,
      worker,
      orderId,
      async createCheckout(uiMode: 'hosted' | 'custom' = 'hosted') {
        const session = await billing.createCheckout(
          { tenantId: 'demo-tenant', actorId: 'demo-user', operationId: `checkout:${orderId}` },
          {
            customerId,
            mode: 'payment',
            uiMode,
            items: [{ priceId, quantity: 1 }],
            reference: orderId,
          },
        );
        await storage.transaction(billing.scopeId, async (tx) => {
          const current = await tx.get<Order>('orders', orderId);
          if (current && current.sessionId !== session.id)
            throw new Error('Order is already bound to another checkout');
          const order: Order = current ?? {
            id: orderId,
            tenantId: 'demo-tenant',
            customerId,
            priceId,
            sessionId: session.id,
            state: 'pending',
          };
          await tx.set('orders', orderId, order);
          await tx.set('sessions', session.id, order);
        });
        return { id: session.id, url: session.url, clientSecret: session.client_secret };
      },
      async status() {
        return (
          (await storage.read<Order>(billing.scopeId, 'orders', orderId))?.state ?? 'not_started'
        );
      },
    };
  } catch (error) {
    await storage.close();
    throw error;
  }
}
