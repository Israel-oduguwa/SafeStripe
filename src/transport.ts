import Stripe from 'stripe';
import { SafeStripeError } from './errors.js';
import {
  API_VERSION,
  digest,
  idempotencyKey,
  scopeKey,
  validateActor,
  type Actor,
  type Authorizer,
  type Resource,
  type Scope,
} from './primitives.js';
import type { Operation } from './operations.js';
import type { OperationStore } from './storage/contracts.js';
import { observe, diagnostic, type Observer } from './telemetry.js';
import { ConcurrencyGate, type ExecutionGate } from './limiter.js';
export interface SafeStripeOptions {
  stripe: Stripe;
  scope: Scope;
  operations: OperationStore;
  authorize: Authorizer;
  /** Trusted deployment configuration, never a request Host header. */
  appOrigin: string;
  allowLocalhost?: boolean;
  gate?: ExecutionGate;
  observer?: Observer;
}
export class DurableStripe {
  readonly scope: Readonly<Scope>;
  readonly scopeId: string;
  readonly stripe: Stripe;
  protected readonly origin: string;
  protected readonly gate: ExecutionGate;
  private readonly observer?: Observer;
  private readonly operations: OperationStore;
  private readonly authorize: Authorizer;

  constructor(options: SafeStripeOptions) {
    this.scopeId = scopeKey(options.scope);
    this.scope = Object.freeze({ ...options.scope });
    this.stripe = options.stripe;
    this.operations = options.operations;
    this.observer = options.observer;
    if (typeof options.authorize !== 'function')
      throw new Error('An application authorizer is required');
    this.authorize = options.authorize;
    this.gate = options.gate ?? new ConcurrencyGate();
    const url = new URL(options.appOrigin);
    const local =
      options.allowLocalhost &&
      !options.scope.livemode &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error('appOrigin must be a trusted HTTPS origin');
    this.origin = url.origin;
  }
  requestOptions(): Stripe.RequestOptions {
    return this.scope.connectedAccountId ? { stripeAccount: this.scope.connectedAccountId } : {};
  }
  protected async permit(
    actor: Actor,
    action: string,
    resources: Resource[],
    parameters: unknown,
  ): Promise<Actor> {
    const checked = validateActor(actor);
    if (
      !(await this.authorize({ actor: checked, scope: this.scope, action, resources, parameters }))
    )
      throw new SafeStripeError('FORBIDDEN', 'Not authorized for these billing resources', 403);
    return checked;
  }
  protected async write<T extends { id: string }>(
    actor: Actor,
    kind: string,
    params: unknown,
    resources: Resource[],
    create: (options: Stripe.RequestOptions) => Promise<T>,
    retrieve: (id: string, options: Stripe.RequestOptions) => Promise<T>,
  ): Promise<T> {
    const started = performance.now();
    let replay = false;
    try {
      const checked = await this.permit(actor, kind, resources, params);
      const op: Operation = {
        scope: this.scopeId,
        tenantId: checked.tenantId,
        operationId: checked.operationId,
        kind,
        fingerprint: digest({ version: API_VERSION, params }),
        key: idempotencyKey(this.scopeId, checked, kind),
      };
      const result = await this.gate.run(async () => {
        const claim = await this.operations.claim(op);
        if (claim.replay) {
          replay = true;
          return retrieve(claim.resourceId, this.requestOptions());
        }
        try {
          const created = await create({ ...this.requestOptions(), idempotencyKey: op.key });
          await this.operations.succeed(op, claim.token, created.id);
          return created;
        } catch (error) {
          try {
            await this.operations.retry(op, claim.token);
          } catch {
            /* Lease expiry will recover it. */
          }
          throw error;
        }
      });
      observe(this.observer, {
        category: 'operation',
        action: kind,
        outcome: replay ? 'replayed' : 'succeeded',
        durationMs: performance.now() - started,
      });
      return result;
    } catch (error) {
      observe(this.observer, {
        category: 'operation',
        action: kind,
        outcome: 'failed',
        durationMs: performance.now() - started,
        ...diagnostic(error),
      });
      if (error instanceof SafeStripeError) throw error;
      throw new SafeStripeError(
        'UPSTREAM_FAILED',
        'Retry the unchanged operation or inspect its Stripe request history',
        502,
      );
    }
  }
}
