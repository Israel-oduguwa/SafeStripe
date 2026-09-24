import type Stripe from 'stripe';
import type { Sql } from './database.js';
import { scopeKey, type Scope } from './primitives.js';

/** Replay a fixed [from,to) window. A repeated scan upserts by Stripe balance-transaction ID. */
export async function importBalanceTransactions(input: {
  stripe: Stripe;
  db: Sql;
  scope: Scope;
  from: number;
  to: number;
}): Promise<number> {
  if (
    !Number.isSafeInteger(input.from) ||
    !Number.isSafeInteger(input.to) ||
    input.from < 0 ||
    input.to <= input.from
  )
    throw new Error('Invalid reconciliation window');
  const scope = scopeKey(input.scope);
  const options = input.scope.connectedAccountId
    ? { stripeAccount: input.scope.connectedAccountId }
    : {};
  let count = 0;
  for await (const item of input.stripe.balanceTransactions.list(
    { created: { gte: input.from, lt: input.to }, limit: 100 },
    options,
  )) {
    const source = typeof item.source === 'string' ? item.source : (item.source?.id ?? null);
    await input.db.query(
      `INSERT INTO sf_balance_transactions(scope,id,currency,amount,fee,net,stripe_created,available_on,status,source_id,type)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(scope,id) DO UPDATE SET
      available_on=excluded.available_on,status=excluded.status`,
      [
        scope,
        item.id,
        item.currency,
        item.amount,
        item.fee,
        item.net,
        item.created,
        item.available_on,
        item.status,
        source,
        item.type,
      ],
    );
    count++;
  }
  return count;
}

export interface ReconciliationLine {
  id: string;
  currency: string;
  net: bigint;
}
export function reconcile(
  expected: readonly ReconciliationLine[],
  actual: readonly ReconciliationLine[],
) {
  const index = (lines: readonly ReconciliationLine[]) => {
    const result = new Map<string, ReconciliationLine>();
    for (const line of lines) {
      if (result.has(line.id)) throw new Error(`Duplicate reconciliation ID: ${line.id}`);
      result.set(line.id, line);
    }
    return result;
  };
  const left = index(expected),
    right = index(actual);
  const missing: string[] = [],
    unexpected: string[] = [],
    mismatched: string[] = [];
  for (const [id, item] of left) {
    const other = right.get(id);
    if (!other) missing.push(id);
    else if (item.currency !== other.currency || item.net !== other.net) mismatched.push(id);
  }
  for (const id of right.keys()) if (!left.has(id)) unexpected.push(id);
  return {
    matched: !missing.length && !unexpected.length && !mismatched.length,
    missing,
    unexpected,
    mismatched,
  };
}
