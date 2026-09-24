import Stripe from 'stripe';
import { z } from 'zod';
import { SafeStripeError } from './errors.js';
import { API_VERSION, integerOption, scopeKey, type Scope } from './primitives.js';
import { PostgresJobs } from './jobs.js';

export interface WebhookOptions {
  stripe: Stripe;
  jobs: PostgresJobs;
  scope: Scope;
  signingSecrets: readonly string[];
  eventTypes: readonly string[];
  maxBytes?: number;
  toleranceSeconds?: number;
}
export class WebhookReceiver {
  readonly maxBytes: number;
  readonly scopeId: string;
  private readonly scope: Readonly<Scope>;
  private readonly secrets: readonly string[];
  private readonly types: Set<string>;
  private readonly tolerance: number;
  constructor(private readonly options: WebhookOptions) {
    this.scopeId = scopeKey(options.scope);
    this.scope = Object.freeze({ ...options.scope });
    this.maxBytes = integerOption(options.maxBytes ?? 1_048_576, 'maxBytes', 1024, 10_485_760);
    this.tolerance = integerOption(options.toleranceSeconds ?? 300, 'toleranceSeconds', 1, 300);
    if (
      options.signingSecrets.length < 1 ||
      options.signingSecrets.length > 3 ||
      options.signingSecrets.some((s) => !/^whsec_[A-Za-z0-9]+$/.test(s))
    )
      throw new Error('Provide 1–3 valid webhook signing secrets');
    if (!options.eventTypes.length) throw new Error('Explicit webhook event types are required');
    this.secrets = [...options.signingSecrets];
    this.types = new Set(options.eventTypes);
  }
  async receive(
    raw: Buffer,
    signature: string | undefined,
  ): Promise<{ received: true; duplicate?: boolean; ignored?: boolean }> {
    if (!Buffer.isBuffer(raw) || raw.byteLength > this.maxBytes)
      throw new SafeStripeError('BODY_TOO_LARGE', 'Expected a bounded raw body', 413);
    if (!signature || signature.length > 4096)
      throw new SafeStripeError('INVALID_WEBHOOK', 'Invalid Stripe signature');
    let event: Stripe.Event | undefined;
    for (const secret of this.secrets) {
      try {
        event = this.options.stripe.webhooks.constructEvent(raw, signature, secret, this.tolerance);
        break;
      } catch {
        /* Try overlapping rotation secret. */
      }
    }
    // Snapshot API v1 only; organization contexts and thin events need a different resolver.
    const schema = z
      .object({
        id: z.string().regex(/^evt_[A-Za-z0-9]+$/),
        object: z.literal('event'),
        type: z.string(),
        livemode: z.boolean(),
        api_version: z.literal(API_VERSION),
        created: z.number().int().nonnegative(),
        account: z.string().optional(),
        context: z.never().optional(),
        data: z.object({ object: z.object({ id: z.string().min(1) }).passthrough() }),
      })
      .passthrough();
    if (
      !event ||
      !schema.safeParse(event).success ||
      event.livemode !== this.scope.livemode ||
      (event.account ?? undefined) !== this.scope.connectedAccountId ||
      event.created > Math.floor(Date.now() / 1000) + this.tolerance
    ) {
      throw new SafeStripeError('INVALID_WEBHOOK', 'Event scope, version or shape is not accepted');
    }
    // Ignore only after authenticity and scope checks; an unhandled event has no business effects.
    if (!this.types.has(event.type)) return { received: true, ignored: true };
    const inserted = await this.options.jobs.enqueue(
      'webhook',
      this.scopeId,
      event.id,
      event.type,
      event,
    );
    return { received: true, duplicate: !inserted };
  }
}
