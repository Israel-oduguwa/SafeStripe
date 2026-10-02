import Stripe from 'stripe';
import { z } from 'zod';
import { SafeStripeError } from './errors.js';
import {
  API_VERSION,
  identifier,
  money,
  parse,
  quantity,
  stripeId,
  type Actor,
} from './primitives.js';
import { BillingScenarios } from './scenarios.js';
export type { SafeStripeOptions } from './transport.js';
export function createStripeClient(key: string, livemode: boolean): Stripe {
  if (!new RegExp(`^[sr]k_${livemode ? 'live' : 'test'}_[A-Za-z0-9]+$`).test(key))
    throw new Error('Stripe key is missing or does not match the configured mode');
  return new Stripe(key, {
    apiVersion: API_VERSION,
    timeout: 10_000,
    maxNetworkRetries: 2,
    telemetry: false,
    appInfo: { name: 'SafeStripe', version: '0.3.0' },
  });
}

const customer = stripeId('cus');
const price = stripeId('price');
const subscription = stripeId('sub');
const invoice = stripeId('in');
export class SafeStripe extends BillingScenarios {
  async createCustomer(actor: Actor, input: { email: string; name?: string }) {
    const params = parse(
      z.object({ email: z.email().max(254), name: z.string().min(1).max(200).optional() }).strict(),
      input,
    );
    return this.write(
      actor,
      'customer.create',
      params,
      [],
      (o) => this.stripe.customers.create(params, o),
      (id, o) => this.stripe.customers.retrieve(id, {}, o),
    );
  }
  async createCheckout(
    actor: Actor,
    input: {
      customerId: string;
      mode: 'payment' | 'subscription';
      uiMode?: 'hosted' | 'custom';
      items: { priceId: string; quantity?: number }[];
      reference: string;
      trialDays?: number;
      allowPromotionCodes?: boolean;
      automaticTax?: boolean;
    },
  ) {
    const data = parse(
      z
        .object({
          customerId: customer,
          mode: z.enum(['payment', 'subscription']),
          uiMode: z.enum(['hosted', 'custom']).optional(),
          items: z
            .array(z.object({ priceId: price, quantity: quantity.optional() }).strict())
            .min(1)
            .max(20),
          reference: identifier,
          trialDays: z.number().int().min(3).max(730).optional(),
          allowPromotionCodes: z.boolean().optional(),
          automaticTax: z.boolean().optional(),
        })
        .strict(),
      input,
    );
    if (data.trialDays !== undefined && data.mode !== 'subscription')
      throw new SafeStripeError('INVALID_INPUT', 'Trials require subscription mode');
    const params: Stripe.Checkout.SessionCreateParams = {
      customer: data.customerId,
      mode: data.mode,
      line_items: data.items.map((x) => ({
        price: x.priceId,
        ...(x.quantity === undefined
          ? data.mode === 'payment'
            ? { quantity: 1 }
            : {}
          : { quantity: x.quantity }),
      })),
      ...(data.trialDays === undefined
        ? {}
        : {
            subscription_data: {
              trial_period_days: data.trialDays,
              trial_settings: { end_behavior: { missing_payment_method: 'pause' } },
            },
          }),
      ...(data.allowPromotionCodes === undefined
        ? {}
        : { allow_promotion_codes: data.allowPromotionCodes }),
      ...(data.automaticTax
        ? {
            automatic_tax: { enabled: true },
            customer_update: { address: 'auto' },
            billing_address_collection: 'required',
          }
        : {}),
      client_reference_id: data.reference,
      integration_identifier: 'safestripe_qvmtxkpa',
      ...(data.uiMode === 'custom'
        ? {
            ui_mode: 'custom' as const,
            return_url: `${this.origin}/success?session_id={CHECKOUT_SESSION_ID}`,
          }
        : {
            success_url: `${this.origin}/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${this.origin}/cancel`,
          }),
    };
    return this.write(
      actor,
      'checkout.create',
      params,
      [
        { kind: 'customer', id: data.customerId },
        ...data.items.map((x) => ({ kind: 'price' as const, id: x.priceId })),
      ],
      async (o) => {
        if (data.automaticTax) await this.assertTaxConfigured();
        return this.stripe.checkout.sessions.create(params, o);
      },
      (id, o) => this.stripe.checkout.sessions.retrieve(id, {}, o),
    );
  }
  /** Advanced custom payment state; use Checkout for ordinary on-session payments. Does not confirm. */
  async createPaymentIntent(
    actor: Actor,
    input: { customerId: string; amount: number; currency: string },
  ) {
    const data = parse(
      z
        .object({ customerId: customer, amount: money, currency: z.string().regex(/^[a-z]{3}$/) })
        .strict(),
      input,
    );
    const params = { customer: data.customerId, amount: data.amount, currency: data.currency };
    return this.write(
      actor,
      'payment_intent.create',
      params,
      [{ kind: 'customer', id: data.customerId }],
      (o) => this.stripe.paymentIntents.create(params, o),
      (id, o) => this.stripe.paymentIntents.retrieve(id, {}, o),
    );
  }
  async createRefund(
    actor: Actor,
    input: {
      paymentIntentId: string;
      amount: number;
      reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer';
    },
  ) {
    const data = parse(
      z
        .object({
          paymentIntentId: stripeId('pi'),
          amount: money,
          reason: z.enum(['duplicate', 'fraudulent', 'requested_by_customer']).optional(),
        })
        .strict(),
      input,
    );
    const params = {
      payment_intent: data.paymentIntentId,
      amount: data.amount,
      ...(data.reason ? { reason: data.reason } : {}),
    };
    return this.write(
      actor,
      'refund.create',
      params,
      [{ kind: 'payment_intent', id: data.paymentIntentId }],
      (o) => this.stripe.refunds.create(params, o),
      (id, o) => this.stripe.refunds.retrieve(id, {}, o),
    );
  }
  /** Draft only. Each subsequent step uses its own stable business operation ID. */
  async createInvoice(actor: Actor, input: { customerId: string; daysUntilDue: number }) {
    const data = parse(
      z.object({ customerId: customer, daysUntilDue: z.number().int().min(1).max(365) }).strict(),
      input,
    );
    const params: Stripe.InvoiceCreateParams = {
      customer: data.customerId,
      collection_method: 'send_invoice',
      days_until_due: data.daysUntilDue,
      auto_advance: false,
      pending_invoice_items_behavior: 'exclude',
    };
    return this.write(
      actor,
      'invoice.create',
      params,
      [{ kind: 'customer', id: data.customerId }],
      (o) => this.stripe.invoices.create(params, o),
      (id, o) => this.stripe.invoices.retrieve(id, {}, o),
    );
  }
  async addInvoiceItem(
    actor: Actor,
    input: { customerId: string; invoiceId: string; priceId: string; quantity: number },
  ) {
    const data = parse(
      z.object({ customerId: customer, invoiceId: invoice, priceId: price, quantity }).strict(),
      input,
    );
    const params = {
      customer: data.customerId,
      invoice: data.invoiceId,
      pricing: { price: data.priceId },
      quantity: data.quantity,
    };
    return this.write(
      actor,
      'invoice_item.create',
      params,
      [
        { kind: 'customer', id: data.customerId },
        { kind: 'invoice', id: data.invoiceId },
        { kind: 'price', id: data.priceId },
      ],
      (o) => this.stripe.invoiceItems.create(params, o),
      (id, o) => this.stripe.invoiceItems.retrieve(id, {}, o),
    );
  }
  async finalizeInvoice(actor: Actor, input: { invoiceId: string }) {
    const data = parse(z.object({ invoiceId: invoice }).strict(), input);
    return this.write(
      actor,
      'invoice.finalize',
      data,
      [{ kind: 'invoice', id: data.invoiceId }],
      (o) => this.stripe.invoices.finalizeInvoice(data.invoiceId, { auto_advance: false }, o),
      (id, o) => this.stripe.invoices.retrieve(id, {}, o),
    );
  }
  async createSubscription(
    actor: Actor,
    input: { customerId: string; priceId: string; quantity: number },
  ) {
    const data = parse(
      z.object({ customerId: customer, priceId: price, quantity }).strict(),
      input,
    );
    const params: Stripe.SubscriptionCreateParams = {
      customer: data.customerId,
      items: [{ price: data.priceId, quantity: data.quantity }],
      payment_behavior: 'default_incomplete',
    };
    return this.write(
      actor,
      'subscription.create',
      params,
      [
        { kind: 'customer', id: data.customerId },
        { kind: 'price', id: data.priceId },
      ],
      (o) => this.stripe.subscriptions.create(params, o),
      (id, o) => this.stripe.subscriptions.retrieve(id, {}, o),
    );
  }
  async cancelSubscriptionAtPeriodEnd(actor: Actor, input: { subscriptionId: string }) {
    const data = parse(z.object({ subscriptionId: subscription }).strict(), input);
    return this.write(
      actor,
      'subscription.cancel_at_period_end',
      data,
      [{ kind: 'subscription', id: data.subscriptionId }],
      (o) =>
        this.stripe.subscriptions.update(data.subscriptionId, { cancel_at_period_end: true }, o),
      (id, o) => this.stripe.subscriptions.retrieve(id, {}, o),
    );
  }
  async previewSubscriptionChange(actor: Actor, input: SubscriptionChange) {
    const data = parse(changeSchema, input);
    await this.permit(
      actor,
      'subscription.preview',
      [
        { kind: 'subscription', id: data.subscriptionId },
        { kind: 'price', id: data.priceId },
      ],
      data,
    );
    return this.gate.run(async () => {
      await this.assertItem(data);
      return this.stripe.invoices.createPreview(
        {
          subscription: data.subscriptionId,
          subscription_details: {
            items: [{ id: data.itemId, price: data.priceId, quantity: data.quantity }],
            proration_date: data.prorationDate,
          },
        },
        this.requestOptions(),
      );
    });
  }
  async updateSubscription(actor: Actor, input: SubscriptionChange) {
    const data = parse(changeSchema, input);
    return this.write(
      actor,
      'subscription.update',
      data,
      [
        { kind: 'subscription', id: data.subscriptionId },
        { kind: 'price', id: data.priceId },
      ],
      async (o) => {
        await this.assertItem(data);
        return this.stripe.subscriptions.update(
          data.subscriptionId,
          {
            items: [{ id: data.itemId, price: data.priceId, quantity: data.quantity }],
            proration_date: data.prorationDate,
            proration_behavior: 'always_invoice',
            payment_behavior: 'pending_if_incomplete',
          },
          o,
        );
      },
      (id, o) => this.stripe.subscriptions.retrieve(id, {}, o),
    );
  }
  private async assertItem(data: SubscriptionChange) {
    const current = await this.stripe.subscriptions.retrieve(
      data.subscriptionId,
      {},
      this.requestOptions(),
    );
    if (!current.items.data.some((item) => item.id === data.itemId))
      throw new SafeStripeError(
        'INVALID_INPUT',
        'Subscription item does not belong to the requested subscription',
      );
  }
  /** Short-lived access session, created afresh after authorization; never persist its URL. */
  async createPortalSession(actor: Actor, customerId: string) {
    parse(customer, customerId);
    await this.permit(actor, 'portal.create', [{ kind: 'customer', id: customerId }], {
      customerId,
    });
    return this.gate.run(() =>
      this.stripe.billingPortal.sessions.create(
        { customer: customerId, return_url: `${this.origin}/billing` },
        this.requestOptions(),
      ),
    );
  }
}
const changeSchema = z
  .object({
    subscriptionId: subscription,
    itemId: stripeId('si'),
    priceId: price,
    quantity,
    prorationDate: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export type SubscriptionChange = z.infer<typeof changeSchema>;
