import Stripe from 'stripe';
import { z } from 'zod';
import { DurableStripe } from './transport.js';
import { SafeStripeError } from './errors.js';
import {
  identifier,
  idempotencyKey,
  money,
  parse,
  quantity,
  stripeId,
  validateActor,
  type Actor,
  type Resource,
} from './primitives.js';

const customer = stripeId('cus');
const price = stripeId('price');
const subscription = stripeId('sub');
const timestamp = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const currency = z.string().regex(/^[a-z]{3}$/);
const items = z
  .array(z.object({ priceId: price, quantity: quantity.optional() }).strict())
  .min(1)
  .max(20);
const subscriptionSchema = z
  .object({
    customerId: customer,
    items,
    trialDays: z.number().int().min(3).max(730).optional(),
    promotionCodeId: stripeId('promo').optional(),
  })
  .strict();
export type SubscriptionPlan = z.infer<typeof subscriptionSchema>;
const scheduleSchema = z
  .object({
    customerId: customer,
    startAt: timestamp,
    endBehavior: z.enum(['release', 'cancel']),
    phases: z
      .array(
        z
          .object({
            items,
            months: z.number().int().min(1).max(120),
          })
          .strict(),
      )
      .min(1)
      .max(10),
    daysUntilDue: z.number().int().min(1).max(365),
  })
  .strict();
export type ContractSchedule = z.infer<typeof scheduleSchema>;
const priceSchema = z
  .object({
    productId: stripeId('prod'),
    currency,
    interval: z.enum(['month', 'year']),
    mode: z.enum(['graduated', 'volume']),
    tiers: z
      .array(
        z
          .object({
            upTo: z.union([quantity, z.literal('inf')]),
            unitAmount: z.number().int().min(0).max(99999999),
            flatAmount: z.number().int().min(0).max(99999999).optional(),
          })
          .strict(),
      )
      .min(2)
      .max(20),
  })
  .strict();
export type TieredPrice = z.infer<typeof priceSchema>;
const itemResources = (lines: { priceId: string }[]): Resource[] =>
  lines.map((x) => ({ kind: 'price', id: x.priceId }));
const stripeItems = (lines: { priceId: string; quantity?: number }[]) =>
  lines.map((x) => ({
    price: x.priceId,
    ...(x.quantity === undefined ? {} : { quantity: x.quantity }),
  }));
const invalid = (message: string): never => {
  throw new SafeStripeError('INVALID_INPUT', message);
};

/** Narrow, durable operations. Your authorizer approves ownership and every financial term. */
export class BillingScenarios extends DurableStripe {
  async createMultiItemSubscription(actor: Actor, input: SubscriptionPlan) {
    const d = parse(subscriptionSchema, input);
    const params: Stripe.SubscriptionCreateParams = {
      customer: d.customerId,
      items: stripeItems(d.items),
      payment_behavior: 'default_incomplete',
      ...(d.trialDays === undefined
        ? {}
        : {
            trial_period_days: d.trialDays,
            trial_settings: { end_behavior: { missing_payment_method: 'pause' } },
          }),
      ...(d.promotionCodeId ? { discounts: [{ promotion_code: d.promotionCodeId }] } : {}),
    };
    return this.write(
      actor,
      'subscription.create_multi',
      d,
      [
        { kind: 'customer', id: d.customerId },
        ...itemResources(d.items),
        ...(d.promotionCodeId ? [{ kind: 'promotion_code' as const, id: d.promotionCodeId }] : []),
      ],
      (o) => this.stripe.subscriptions.create(params, o),
      (id, o) => this.stripe.subscriptions.retrieve(id, {}, o),
    );
  }

  /** Hosted setup flow collects consent and confirms a SetupIntent without charging. */
  async createSetupCheckout(
    actor: Actor,
    input: { customerId: string; reference: string; currency: string },
  ) {
    const d = parse(
      z.object({ customerId: customer, reference: identifier, currency }).strict(),
      input,
    );
    return this.write(
      actor,
      'checkout.setup',
      d,
      [{ kind: 'customer', id: d.customerId }],
      (o) =>
        this.stripe.checkout.sessions.create(
          {
            customer: d.customerId,
            mode: 'setup',
            currency: d.currency,
            client_reference_id: d.reference,
            integration_identifier: 'safestripe_qvmtxkpa',
            success_url: `${this.origin}/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${this.origin}/cancel`,
          },
          o,
        ),
      (id, o) => this.stripe.checkout.sessions.retrieve(id, {}, o),
    );
  }

  /** Unconfirmed; use Stripe.js confirmSetup or use createSetupCheckout for a complete UI. */
  async createSetupIntent(actor: Actor, input: { customerId: string }) {
    const d = parse(z.object({ customerId: customer }).strict(), input);
    return this.write(
      actor,
      'setup_intent.create',
      d,
      [{ kind: 'customer', id: d.customerId }],
      (o) =>
        this.stripe.setupIntents.create(
          {
            customer: d.customerId,
            usage: 'off_session',
            automatic_payment_methods: { enabled: true },
          },
          o,
        ),
      (id, o) => this.stripe.setupIntents.retrieve(id, {}, o),
    );
  }

  /** Reusable public sale link: it is deliberately not bound to a particular customer. */
  async createPaymentLink(actor: Actor, input: { priceId: string; quantity: number }) {
    const d = parse(z.object({ priceId: price, quantity }).strict(), input);
    return this.write(
      actor,
      'payment_link.create',
      d,
      [{ kind: 'price', id: d.priceId }],
      (o) =>
        this.stripe.paymentLinks.create(
          { line_items: [{ price: d.priceId, quantity: d.quantity }] },
          o,
        ),
      (id, o) => this.stripe.paymentLinks.retrieve(id, {}, o),
    );
  }

  /** Pauses collection, not the subscription lifecycle or your customer's access. */
  async setSubscriptionCollection(
    actor: Actor,
    input: {
      subscriptionId: string;
      behavior: 'keep_as_draft' | 'void' | 'mark_uncollectible' | 'collect';
    },
  ) {
    const d = parse(
      z
        .object({
          subscriptionId: subscription,
          behavior: z.enum(['keep_as_draft', 'void', 'mark_uncollectible', 'collect']),
        })
        .strict(),
      input,
    );
    return this.write(
      actor,
      'subscription.collection',
      d,
      [{ kind: 'subscription', id: d.subscriptionId }],
      (o) =>
        this.stripe.subscriptions.update(
          d.subscriptionId,
          { pause_collection: d.behavior === 'collect' ? '' : { behavior: d.behavior } },
          o,
        ),
      (id, o) => this.stripe.subscriptions.retrieve(id, {}, o),
    );
  }

  async restoreSubscription(actor: Actor, input: { subscriptionId: string }) {
    const d = parse(z.object({ subscriptionId: subscription }).strict(), input);
    return this.write(
      actor,
      'subscription.restore',
      d,
      [{ kind: 'subscription', id: d.subscriptionId }],
      (o) => this.stripe.subscriptions.update(d.subscriptionId, { cancel_at_period_end: false }, o),
      (id, o) => this.stripe.subscriptions.retrieve(id, {}, o),
    );
  }

  /** Only for status=paused. A successful response can still require an invoice payment. */
  async resumePausedSubscription(actor: Actor, input: { subscriptionId: string }) {
    const d = parse(z.object({ subscriptionId: subscription }).strict(), input);
    return this.write(
      actor,
      'subscription.resume',
      d,
      [{ kind: 'subscription', id: d.subscriptionId }],
      (o) => this.stripe.subscriptions.resume(d.subscriptionId, { billing_cycle_anchor: 'now' }, o),
      (id, o) => this.stripe.subscriptions.retrieve(id, {}, o),
    );
  }

  async createTieredPrice(actor: Actor, input: TieredPrice) {
    const d = parse(priceSchema, input);
    let previous = 0;
    d.tiers.forEach((tier, i) => {
      if (tier.upTo === 'inf') {
        if (i !== d.tiers.length - 1) invalid('Only the final tier can be infinite');
      } else {
        if (tier.upTo <= previous || i === d.tiers.length - 1)
          invalid('Use increasing tier limits and a final infinite tier');
        previous = tier.upTo;
      }
    });
    return this.write(
      actor,
      'price.create_tiered',
      d,
      [{ kind: 'product', id: d.productId }],
      (o) =>
        this.stripe.prices.create(
          {
            product: d.productId,
            currency: d.currency,
            recurring: { interval: d.interval },
            billing_scheme: 'tiered',
            tiers_mode: d.mode,
            tiers: d.tiers.map((t) => ({
              up_to: t.upTo,
              unit_amount: t.unitAmount,
              ...(t.flatAmount === undefined ? {} : { flat_amount: t.flatAmount }),
            })),
          },
          o,
        ),
      (id, o) => this.stripe.prices.retrieve(id, {}, o),
    );
  }

  /** Net-term phased contract. Creation does not send an invoice email. */
  async createSchedule(actor: Actor, input: ContractSchedule) {
    const d = parse(scheduleSchema, input);
    return this.write(
      actor,
      'schedule.create',
      d,
      [{ kind: 'customer', id: d.customerId }, ...d.phases.flatMap((p) => itemResources(p.items))],
      (o) =>
        this.stripe.subscriptionSchedules.create(
          {
            customer: d.customerId,
            start_date: d.startAt,
            end_behavior: d.endBehavior,
            default_settings: {
              collection_method: 'send_invoice',
              invoice_settings: { days_until_due: d.daysUntilDue },
            },
            phases: d.phases.map((p) => ({
              items: stripeItems(p.items),
              duration: { interval: 'month', interval_count: p.months },
              proration_behavior: 'none',
            })),
          },
          o,
        ),
      (id, o) => this.stripe.subscriptionSchedules.retrieve(id, {}, o),
    );
  }

  async createQuote(
    actor: Actor,
    input: {
      customerId: string;
      items: { priceId: string; quantity: number }[];
      daysUntilDue: number;
    },
  ) {
    const d = parse(
      z
        .object({
          customerId: customer,
          items: z
            .array(z.object({ priceId: price, quantity }).strict())
            .min(1)
            .max(20),
          daysUntilDue: z.number().int().min(1).max(365),
        })
        .strict(),
      input,
    );
    return this.write(
      actor,
      'quote.create',
      d,
      [{ kind: 'customer', id: d.customerId }, ...itemResources(d.items)],
      (o) =>
        this.stripe.quotes.create(
          {
            customer: d.customerId,
            line_items: stripeItems(d.items),
            collection_method: 'send_invoice',
            invoice_settings: { days_until_due: d.daysUntilDue },
          },
          o,
        ),
      (id, o) => this.stripe.quotes.retrieve(id, {}, o),
    );
  }
  async finalizeQuote(actor: Actor, input: { quoteId: string }) {
    const d = parse(z.object({ quoteId: stripeId('qt') }).strict(), input);
    return this.write(
      actor,
      'quote.finalize',
      d,
      [{ kind: 'quote', id: d.quoteId }],
      (o) => this.stripe.quotes.finalizeQuote(d.quoteId, {}, o),
      (id, o) => this.stripe.quotes.retrieve(id, {}, o),
    );
  }
  /** Call only after recording the customer's acceptance in your application. */
  async acceptQuote(actor: Actor, input: { quoteId: string }) {
    const d = parse(z.object({ quoteId: stripeId('qt') }).strict(), input);
    return this.write(
      actor,
      'quote.accept',
      d,
      [{ kind: 'quote', id: d.quoteId }],
      (o) => this.stripe.quotes.accept(d.quoteId, {}, o),
      (id, o) => this.stripe.quotes.retrieve(id, {}, o),
    );
  }

  /** Narrow adjustment for an unpaid open invoice. Does not refund a paid invoice. */
  async createCreditNote(actor: Actor, input: { invoiceId: string; amount: number; memo: string }) {
    const d = parse(
      z
        .object({ invoiceId: stripeId('in'), amount: money, memo: z.string().min(1).max(500) })
        .strict(),
      input,
    );
    return this.write(
      actor,
      'credit_note.create',
      d,
      [{ kind: 'invoice', id: d.invoiceId }],
      async (o) => {
        const inv = await this.stripe.invoices.retrieve(d.invoiceId, {}, this.requestOptions());
        if (inv.status !== 'open' || d.amount > inv.amount_remaining)
          invalid('Use an open invoice and an amount within its unpaid balance');
        return this.stripe.creditNotes.create(
          { invoice: d.invoiceId, amount: d.amount, memo: d.memo },
          o,
        );
      },
      (id, o) => this.stripe.creditNotes.retrieve(id, {}, o),
    );
  }
  /** Negative amounts credit a future invoice; positive amounts debit. This is not cash. */
  async adjustCustomerBalance(
    actor: Actor,
    input: { customerId: string; amount: number; currency: string; description: string },
  ) {
    const d = parse(
      z
        .object({
          customerId: customer,
          amount: z
            .number()
            .int()
            .min(-99999999)
            .max(99999999)
            .refine((n) => n !== 0),
          currency,
          description: z.string().min(1).max(500),
        })
        .strict(),
      input,
    );
    return this.write(
      actor,
      'customer.balance_adjust',
      d,
      [{ kind: 'customer', id: d.customerId }],
      (o) =>
        this.stripe.customers.createBalanceTransaction(
          d.customerId,
          { amount: d.amount, currency: d.currency, description: d.description },
          o,
        ),
      (id, o) => this.stripe.customers.retrieveBalanceTransaction(d.customerId, id, {}, o),
    );
  }

  /** Basic Billing Meters, for existing meter-based integrations. New UBB: evaluate Metronome. */
  async createMeter(actor: Actor, input: { eventName: string; displayName: string }) {
    const d = parse(
      z
        .object({
          eventName: z.string().regex(/^[a-zA-Z0-9_]{1,100}$/),
          displayName: z.string().min(1).max(100),
        })
        .strict(),
      input,
    );
    return this.write(
      actor,
      'meter.create',
      d,
      [],
      (o) =>
        this.stripe.billing.meters.create(
          {
            event_name: d.eventName,
            display_name: d.displayName,
            default_aggregation: { formula: 'sum' },
            customer_mapping: { type: 'by_id', event_payload_key: 'stripe_customer_id' },
            value_settings: { event_payload_key: 'value' },
          },
          o,
        ),
      (id, o) => this.stripe.billing.meters.retrieve(id, {}, o),
    );
  }

  /** Acknowledges ingestion, not rated usage or a paid invoice. Keep your own usage ledger. */
  async recordUsage(
    actor: Actor,
    input: { customerId: string; meterId: string; value: number; timestamp: number },
  ) {
    const d = parse(
      z
        .object({
          customerId: customer,
          meterId: stripeId('mtr'),
          value: z.number().int().min(0).max(999999999),
          timestamp,
        })
        .strict(),
      input,
    );
    const key = idempotencyKey(this.scopeId, validateActor(actor), 'usage.record');
    const receipt = { id: key, identifier: key, status: 'accepted' as const, ...d };
    return this.write(
      actor,
      'usage.record',
      d,
      [
        { kind: 'customer', id: d.customerId },
        { kind: 'meter', id: d.meterId },
      ],
      async (o) => {
        const now = Math.floor(Date.now() / 1000);
        if (d.timestamp < now - 35 * 86400 || d.timestamp > now + 300)
          invalid('Usage timestamp is outside the Stripe ingestion window');
        const meter = await this.stripe.billing.meters.retrieve(
          d.meterId,
          {},
          this.requestOptions(),
        );
        if (
          meter.status !== 'active' ||
          meter.default_aggregation.formula !== 'sum' ||
          meter.event_time_window
        )
          invalid('Use an active raw sum meter');
        await this.stripe.billing.meterEvents.create(
          {
            event_name: meter.event_name,
            identifier: key,
            timestamp: d.timestamp,
            payload: {
              [meter.customer_mapping.event_payload_key]: d.customerId,
              [meter.value_settings.event_payload_key]: String(d.value),
            },
          },
          o,
        );
        return receipt;
      },
      async () => receipt,
    );
  }

  private sandboxOnly() {
    if (this.scope.livemode)
      throw new SafeStripeError('FORBIDDEN', 'Test clocks are sandbox-only', 403);
  }
  async createTestClock(actor: Actor, input: { frozenTime: number; name: string }) {
    this.sandboxOnly();
    const d = parse(
      z.object({ frozenTime: timestamp, name: z.string().min(1).max(100) }).strict(),
      input,
    );
    return this.write(
      actor,
      'test_clock.create',
      d,
      [],
      (o) =>
        this.stripe.testHelpers.testClocks.create({ frozen_time: d.frozenTime, name: d.name }, o),
      (id, o) => this.stripe.testHelpers.testClocks.retrieve(id, {}, o),
    );
  }
  async advanceTestClock(actor: Actor, input: { clockId: string; frozenTime: number }) {
    this.sandboxOnly();
    const d = parse(
      z.object({ clockId: stripeId('clock'), frozenTime: timestamp }).strict(),
      input,
    );
    return this.write(
      actor,
      'test_clock.advance',
      d,
      [{ kind: 'test_clock', id: d.clockId }],
      (o) =>
        this.stripe.testHelpers.testClocks.advance(d.clockId, { frozen_time: d.frozenTime }, o),
      (id, o) => this.stripe.testHelpers.testClocks.retrieve(id, {}, o),
    );
  }
  async createClockCustomer(actor: Actor, input: { clockId: string; email: string }) {
    this.sandboxOnly();
    const d = parse(
      z.object({ clockId: stripeId('clock'), email: z.email().max(254) }).strict(),
      input,
    );
    return this.write(
      actor,
      'customer.create_clock',
      d,
      [{ kind: 'test_clock', id: d.clockId }],
      (o) => this.stripe.customers.create({ test_clock: d.clockId, email: d.email }, o),
      (id, o) => this.stripe.customers.retrieve(id, {}, o),
    );
  }

  private platformOnly() {
    if (this.scope.connectedAccountId)
      invalid('Use the platform scope for marketplace account and transfer operations');
  }
  /** Recipient model: the platform accepts fees and loss liability. Complete hosted onboarding. */
  async createMarketplaceAccount(
    actor: Actor,
    input: { email: string; country: string; displayName: string },
  ) {
    this.platformOnly();
    const d = parse(
      z
        .object({
          email: z.email().max(254),
          country: z.string().regex(/^[A-Z]{2}$/),
          displayName: z.string().min(1).max(100),
        })
        .strict(),
      input,
    );
    return this.write(
      actor,
      'account.create_recipient',
      d,
      [],
      (o) =>
        this.stripe.v2.core.accounts.create(
          {
            contact_email: d.email,
            display_name: d.displayName,
            identity: { country: d.country },
            dashboard: 'express',
            defaults: {
              responsibilities: { fees_collector: 'application', losses_collector: 'application' },
            },
            configuration: {
              recipient: {
                capabilities: { stripe_balance: { stripe_transfers: { requested: true } } },
              },
            },
            include: ['configuration.recipient'],
          },
          o,
        ),
      (id, o) =>
        this.stripe.v2.core.accounts.retrieve(id, { include: ['configuration.recipient'] }, o),
    );
  }
  /** Ephemeral URL: never log it or save it in a public history. Authenticate its refresh route. */
  async createOnboardingLink(actor: Actor, input: { accountId: string }) {
    this.platformOnly();
    const d = parse(z.object({ accountId: stripeId('acct') }).strict(), input);
    await this.permit(actor, 'account.onboard', [{ kind: 'account', id: d.accountId }], d);
    return this.gate.run(() =>
      this.stripe.v2.core.accountLinks.create(
        {
          account: d.accountId,
          use_case: {
            type: 'account_onboarding',
            account_onboarding: {
              configurations: ['recipient'],
              refresh_url: `${this.origin}/connect/refresh`,
              return_url: `${this.origin}/connect/return`,
            },
          },
        },
        this.requestOptions(),
      ),
    );
  }
  /** Separate charges/transfers. Fees are retained by transferring less; never application_fee_amount. */
  async createTransfer(
    actor: Actor,
    input: { accountId: string; chargeId: string; amount: number; currency: string; group: string },
  ) {
    this.platformOnly();
    const d = parse(
      z
        .object({
          accountId: stripeId('acct'),
          chargeId: stripeId('ch'),
          amount: money,
          currency,
          group: identifier,
        })
        .strict(),
      input,
    );
    return this.write(
      actor,
      'transfer.create',
      d,
      [
        { kind: 'account', id: d.accountId },
        { kind: 'charge', id: d.chargeId },
      ],
      async (o) => {
        const account = await this.stripe.v2.core.accounts.retrieve(
          d.accountId,
          { include: ['configuration.recipient'] },
          this.requestOptions(),
        );
        if (
          account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers
            ?.status !== 'active'
        )
          invalid('Recipient transfer capability is not active');
        const charge = await this.stripe.charges.retrieve(d.chargeId, {}, this.requestOptions());
        if (
          !charge.paid ||
          charge.disputed ||
          charge.livemode !== this.scope.livemode ||
          charge.currency !== d.currency ||
          d.amount > charge.amount - charge.amount_refunded
        )
          invalid('Source charge is not eligible');
        return this.stripe.transfers.create(
          {
            destination: d.accountId,
            source_transaction: d.chargeId,
            amount: d.amount,
            currency: d.currency,
            transfer_group: d.group,
          },
          o,
        );
      },
      (id, o) => this.stripe.transfers.retrieve(id, {}, o),
    );
  }
  async reverseTransfer(actor: Actor, input: { transferId: string; amount: number }) {
    this.platformOnly();
    const d = parse(z.object({ transferId: stripeId('tr'), amount: money }).strict(), input);
    return this.write(
      actor,
      'transfer.reverse',
      d,
      [{ kind: 'transfer', id: d.transferId }],
      (o) => this.stripe.transfers.createReversal(d.transferId, { amount: d.amount }, o),
      (id, o) => this.stripe.transfers.retrieveReversal(d.transferId, id, {}, o),
    );
  }

  /** Explicit opt-in: return the URL only to the user whose reference your authorizer approves. */
  async createIdentitySession(actor: Actor, input: { reference: string }) {
    const d = parse(z.object({ reference: identifier }).strict(), input);
    return this.write(
      actor,
      'identity.create',
      d,
      [{ kind: 'identity_reference', id: d.reference }],
      (o) =>
        this.stripe.identity.verificationSessions.create(
          {
            type: 'document',
            client_reference_id: d.reference,
            return_url: `${this.origin}/identity/return`,
          },
          o,
        ),
      (id, o) => this.stripe.identity.verificationSessions.retrieve(id, {}, o),
    );
  }

  async inspectTaxSetup(actor: Actor) {
    await this.permit(actor, 'tax.inspect', [], {});
    return this.gate.run(async () => {
      const [settings, registrations] = await Promise.all([
        this.stripe.tax.settings.retrieve({}, this.requestOptions()),
        this.stripe.tax.registrations.list({ status: 'active', limit: 100 }, this.requestOptions()),
      ]);
      return {
        settingsStatus: settings.status,
        activeRegistrationIds: registrations.data.map((r) => r.id),
        hasMore: registrations.has_more,
        readyForCalculation: settings.status === 'active' && registrations.data.length > 0,
        note: 'Account prerequisites only. Verify customer jurisdiction, product tax code and a sandbox calculation before collecting tax.',
      };
    });
  }
  protected async assertTaxConfigured() {
    const [settings, registrations] = await Promise.all([
      this.stripe.tax.settings.retrieve({}, this.requestOptions()),
      this.stripe.tax.registrations.list({ status: 'active', limit: 1 }, this.requestOptions()),
    ]);
    if (settings.status !== 'active' || !registrations.data.length)
      invalid('Configure Tax settings and an active registration first');
  }
}
