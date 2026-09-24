import { SafeStripeError } from './errors.js';

/** Deliberately excludes payloads, customer identifiers, keys and error messages. */
export interface TelemetryEvent {
  category: 'operation' | 'job' | 'worker';
  action: string;
  outcome: 'succeeded' | 'replayed' | 'failed';
  durationMs: number;
  attempt?: number;
  code?: string;
  requestId?: string;
  stripeType?: string;
}
export type Observer = (event: Readonly<TelemetryEvent>) => void | Promise<void>;

/** Observability is best effort and never changes a payment's result. */
export function observe(observer: Observer | undefined, event: TelemetryEvent): void {
  if (!observer) return;
  try {
    void Promise.resolve(observer(Object.freeze({ ...event }))).catch(() => {});
  } catch {
    /* A telemetry outage must not retry a financial operation. */
  }
}

export function diagnostic(
  error: unknown,
): Pick<TelemetryEvent, 'code' | 'requestId' | 'stripeType'> {
  if (error instanceof SafeStripeError) return { code: error.code };
  if (!error || typeof error !== 'object') return { code: 'UNEXPECTED_FAILURE' };
  const value = error as Record<string, unknown>;
  const requestId =
    typeof value.requestId === 'string' && /^req_[A-Za-z0-9]{1,100}$/.test(value.requestId)
      ? value.requestId
      : undefined;
  const types = [
    'StripeCardError',
    'StripeRateLimitError',
    'StripeInvalidRequestError',
    'StripeAPIError',
    'StripeConnectionError',
    'StripeAuthenticationError',
    'StripePermissionError',
    'StripeIdempotencyError',
  ];
  const stripeType =
    typeof value.type === 'string' && types.includes(value.type) ? value.type : undefined;
  return {
    code: stripeType ? 'STRIPE_FAILURE' : 'UNEXPECTED_FAILURE',
    ...(requestId ? { requestId } : {}),
    ...(stripeType ? { stripeType } : {}),
  };
}
