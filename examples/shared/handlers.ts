import type Stripe from 'stripe';
import { effectOnce, refreshProjection, type EventHandler } from '../../src/index.js';
import type { getRuntime } from './runtime.js';

/** Demo projections and fulfillment. Add your application's entitlement and accounting policies. */
export function buildHandlers(r: ReturnType<typeof getRuntime>): Record<string, EventHandler> {
  const options: Stripe.RequestOptions = {
    ...r.safe.requestOptions(),
    maxNetworkRetries: 0,
    timeout: 10_000,
  };
  const checkout: EventHandler = async (event, tx) => {
    const id = (event.data.object as Stripe.Checkout.Session).id;
    const orderResult = await tx.query(
      'SELECT * FROM sf_demo_orders WHERE scope=$1 AND session_id=$2 FOR UPDATE',
      [r.safe.scopeId, id],
    );
    const order = orderResult.rows[0];
    if (!order)
      throw new Error(
        'Unknown session; retry until the API result is durably bound or reconcile manually',
      );
    const session = await r.stripe.checkout.sessions.retrieve(id, {}, options);
    const customerId =
      typeof session.customer === 'string' ? session.customer : session.customer?.id;
    if (
      customerId !== order.customer_id ||
      session.client_reference_id !== order.order_id ||
      session.mode !== order.mode
    )
      throw new Error('Session ownership mismatch');
    if (session.status !== 'complete' || session.payment_status === 'unpaid') return;
    const items = await r.stripe.checkout.sessions.listLineItems(id, { limit: 100 }, options);
    if (
      items.has_more ||
      items.data.length !== 1 ||
      items.data[0]?.price?.id !== order.price_id ||
      items.data[0]?.quantity !== 1
    )
      throw new Error('Purchased items do not match the authorized order');
    await effectOnce(
      tx,
      r.safe.scopeId,
      `${order.tenant_id}:${order.order_id}:fulfill`,
      async () => {
        // Subscription access needs a separate entitlement policy; initial Checkout alone is insufficient.
        const state = session.mode === 'payment' ? 'fulfilled' : 'checkout_complete';
        await tx.query('UPDATE sf_demo_orders SET state=$3 WHERE scope=$1 AND order_id=$2', [
          r.safe.scopeId,
          order.order_id,
          state,
        ]);
        await r.jobs.enqueue(
          'outbox',
          r.safe.scopeId,
          `${order.tenant_id}:${order.order_id}:receipt`,
          'order.confirmed',
          { orderId: order.order_id, tenantId: order.tenant_id },
          tx,
        );
      },
    );
  };
  const subscription: EventHandler = async (event, tx) => {
    const id = (event.data.object as Stripe.Subscription).id;
    await refreshProjection(tx, r.safe.scopeId, id, async () => {
      const current = await r.stripe.subscriptions.retrieve(id, {}, options);
      const customerId =
        typeof current.customer === 'string' ? current.customer : current.customer.id;
      if (customerId !== r.customerId) throw new Error('Subscription has no demo tenant mapping');
      return {
        id,
        customerId,
        status: current.status,
        cancelAtPeriodEnd: current.cancel_at_period_end,
        items: current.items.data.map((x) => ({
          id: x.id,
          priceId: x.price.id,
          quantity: x.quantity ?? 0,
        })),
      };
    });
  };
  const invoice: EventHandler = async (event, tx) => {
    const id = (event.data.object as Stripe.Invoice).id;
    await refreshProjection(tx, r.safe.scopeId, id, async () => {
      const current = await r.stripe.invoices.retrieve(id, {}, options);
      const customerId =
        typeof current.customer === 'string' ? current.customer : current.customer?.id;
      if (customerId !== r.customerId) throw new Error('Invoice has no demo tenant mapping');
      return {
        id,
        customerId,
        status: current.status,
        amountDue: current.amount_due,
        amountPaid: current.amount_paid,
        currency: current.currency,
      };
    });
    // Store an intent for the application's recovery/notification service. Do not send inside this transaction.
    if (
      event.type === 'invoice.payment_failed' ||
      event.type === 'invoice.payment_action_required'
    ) {
      await r.jobs.enqueue(
        'outbox',
        r.safe.scopeId,
        `billing-review:${event.id}`,
        'billing.review_required',
        { invoiceId: id },
        tx,
      );
    }
  };
  return {
    'checkout.session.completed': checkout,
    'checkout.session.async_payment_succeeded': checkout,
    'checkout.session.async_payment_failed': async (event, tx) => {
      const id = (event.data.object as Stripe.Checkout.Session).id;
      await tx.query(
        "UPDATE sf_demo_orders SET state='payment_failed' WHERE scope=$1 AND session_id=$2 AND state='pending'",
        [r.safe.scopeId, id],
      );
    },
    'customer.subscription.created': subscription,
    'customer.subscription.updated': subscription,
    'customer.subscription.deleted': subscription,
    'customer.subscription.paused': subscription,
    'customer.subscription.resumed': subscription,
    'invoice.paid': invoice,
    'invoice.payment_failed': invoice,
    'invoice.payment_action_required': invoice,
  };
}
