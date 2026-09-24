import { createHash } from 'node:crypto';
import { z } from 'zod';
import { SafeStripeError } from './errors.js';

export const API_VERSION = '2026-08-26.dahlia' as const;
export const SDK_VERSION = '22.6.2';
export const identifier = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_.:-]+$/);
export const money = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const quantity = z.number().int().positive().max(999999);
export const stripeId = (prefix: string) =>
  z
    .string()
    .max(200)
    .regex(new RegExp(`^${prefix}_[A-Za-z0-9]+$`));

export interface Scope {
  platformAccountId: string;
  connectedAccountId?: string;
  livemode: boolean;
}
export interface Actor {
  tenantId: string;
  actorId: string;
  operationId: string;
}
export type Resource = {
  kind: 'customer' | 'price' | 'payment_intent' | 'invoice' | 'subscription';
  id: string;
};
export type Authorizer = (input: {
  actor: Actor;
  scope: Readonly<Scope>;
  action: string;
  resources: readonly Resource[];
  parameters: unknown;
}) => Promise<boolean>;

export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new SafeStripeError('INVALID_INPUT', 'Input does not match the operation contract');
  return result.data;
}
export function validateActor(value: Actor): Actor {
  return parse(
    z.object({ tenantId: identifier, actorId: identifier, operationId: identifier }).strict(),
    value,
  );
}
export function scopeKey(value: Scope): string {
  const scope = parse(
    z
      .object({
        platformAccountId: stripeId('acct'),
        connectedAccountId: stripeId('acct').optional(),
        livemode: z.boolean(),
      })
      .strict(),
    value,
  );
  return JSON.stringify([
    scope.platformAccountId,
    scope.connectedAccountId ?? null,
    scope.livemode,
  ]);
}

/** JSON-compatible input only; reject ambiguous values instead of silently hashing them. */
export function canonical(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  throw new SafeStripeError('INVALID_INPUT', 'Only finite JSON values are supported');
}
export function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export function idempotencyKey(scope: string, actor: Actor, kind: string): string {
  // Business operation identity, not the cart hash: identical purchases can be legitimate.
  return `sf_v1_${digest([scope, actor.tenantId, actor.operationId, kind])}`;
}
export function integerOption(value: number, name: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`Invalid ${name}`);
  return value;
}
