export type ErrorCode =
  | 'INVALID_INPUT'
  | 'FORBIDDEN'
  | 'BUSY'
  | 'PAYLOAD_CONFLICT'
  | 'REVIEW_REQUIRED'
  | 'LEASE_LOST'
  | 'INVALID_WEBHOOK'
  | 'BODY_TOO_LARGE'
  | 'UPSTREAM_FAILED';

export class SafeStripeError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = 'SafeStripeError';
  }
}

// Never expose Stripe/SQL error messages: they can contain customer data or request parameters.
export function publicError(error: unknown): { status: number; body: { error: string } } {
  if (error instanceof SafeStripeError)
    return { status: error.status, body: { error: error.code } };
  return { status: 503, body: { error: 'TEMPORARILY_UNAVAILABLE' } };
}
