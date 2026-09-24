import { SafeStripe, createStripeClient, type SafeStripeOptions } from './client.js';
import type { BillingStorage } from './storage/store.js';
import { WebhookReceiver, type WebhookOptions } from './webhooks.js';
import { WebhookWorker, type EventHandler } from './worker.js';
import type { BillingTransaction } from './storage/contracts.js';
import { SafeStripeError } from './errors.js';

export interface SetupOptions extends Pick<
  SafeStripeOptions,
  'authorize' | 'appOrigin' | 'allowLocalhost' | 'gate' | 'observer'
> {
  secretKey: string;
  storage: BillingStorage;
  /** Usually discovered from your key. Set explicitly for restricted keys without account-read permission. */
  accountId?: string;
  connectedAccountId?: string;
}
export type ConfiguredBilling = SafeStripe & {
  storage: BillingStorage;
  webhooks(
    options: Pick<WebhookOptions, 'signingSecrets' | 'eventTypes' | 'toleranceSeconds'>,
  ): WebhookReceiver;
  worker(
    handlers: Record<string, EventHandler<BillingTransaction>>,
  ): WebhookWorker<BillingTransaction>;
};
/** Cache the returned promise once per server process; don't initialize for every request. */
export async function createSafeStripe(options: SetupOptions): Promise<ConfiguredBilling> {
  const livemode = /^[sr]k_live_/.test(options.secretKey);
  if (livemode && options.storage.kind === 'sqlite')
    throw new Error(
      'The SQLite adapter is for local sandbox development; choose a shared database for live payments',
    );
  const stripe = createStripeClient(options.secretKey, livemode);
  let accountId = options.accountId;
  if (!accountId) {
    try {
      accountId = (await stripe.accounts.retrieve(null)).id;
    } catch {
      throw new SafeStripeError(
        'UPSTREAM_FAILED',
        'Cannot discover the Stripe account. Check your server key or supply accountId for a restricted key.',
        502,
      );
    }
  }
  const billing = new SafeStripe({
    ...options,
    stripe,
    operations: options.storage.operations,
    scope: {
      platformAccountId: accountId,
      connectedAccountId: options.connectedAccountId,
      livemode,
    },
  });
  return Object.assign(billing, {
    storage: options.storage,
    webhooks: (
      config: Pick<WebhookOptions, 'signingSecrets' | 'eventTypes' | 'toleranceSeconds'>,
    ) =>
      new WebhookReceiver({
        ...config,
        stripe,
        scope: billing.scope,
        jobs: options.storage.jobs,
        maxBytes: options.storage.maxPayloadBytes - 1024,
      }),
    worker: (handlers: Record<string, EventHandler<BillingTransaction>>) =>
      new WebhookWorker(options.storage.jobs, billing.scopeId, handlers, {
        observer: options.observer,
      }),
  });
}
