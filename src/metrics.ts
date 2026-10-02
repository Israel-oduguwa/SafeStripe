/** A customer-level, single-currency snapshot. Amounts are monthly minor units after discounts, before tax. */
export interface RevenueCustomer {
  customerId: string;
  monthlyAmount: number;
}
export interface RevenueSnapshots {
  currency: string;
  start: readonly RevenueCustomer[];
  end: readonly RevenueCustomer[];
}
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
function integer(n: unknown, name: string, positive = false): asserts n is number {
  if (!Number.isSafeInteger(n) || (n as number) < (positive ? 1 : 0))
    throw new Error(`${name} must be a ${positive ? 'positive' : 'nonnegative'} safe integer`);
}
function safe(n: bigint): number {
  if (n > MAX || n < -MAX) throw new Error('Amount exceeds safe integer range');
  return Number(n);
}
const rounded = (n: bigint, divisor: bigint) => safe((n + divisor / 2n) / divisor);

/** Normalize a fixed recurring charge; round half up once per customer snapshot. No usage forecast. */
export function monthlyRecurringAmount(input: {
  amount: number;
  interval: 'day' | 'week' | 'month' | 'year';
  intervalCount?: number;
}): number {
  integer(input.amount, 'amount');
  const count = input.intervalCount ?? 1;
  integer(count, 'intervalCount', true);
  const amount = BigInt(input.amount),
    divisor = BigInt(count);
  switch (input.interval) {
    case 'month':
      return rounded(amount, divisor);
    case 'year':
      return rounded(amount, 12n * divisor);
    case 'week':
      return rounded(amount * 52n, 12n * divisor);
    case 'day':
      return rounded(amount * 365n, 12n * divisor);
    default:
      throw new Error('Unsupported billing interval');
  }
}
function snapshot(rows: readonly RevenueCustomer[]) {
  if (!Array.isArray(rows) || rows.length > 100000)
    throw new Error('Provide at most 100,000 customer rows per snapshot');
  const result = new Map<string, bigint>();
  for (const row of rows) {
    if (
      !row ||
      typeof row.customerId !== 'string' ||
      !row.customerId.trim() ||
      row.customerId.length > 200 ||
      result.has(row.customerId)
    )
      throw new Error('Customer IDs must be present and unique within each snapshot');
    integer(row.monthlyAmount, 'monthlyAmount');
    result.set(row.customerId, BigInt(row.monthlyAmount));
  }
  return result;
}
/** Cohort movements across two supplied snapshots, not a GAAP revenue or profit report. */
export function calculateRevenueMetrics(input: RevenueSnapshots) {
  if (!/^[a-z]{3}$/.test(input.currency)) throw new Error('Use a lowercase three-letter currency');
  const start = snapshot(input.start),
    end = snapshot(input.end);
  let startMrr = 0n,
    endMrr = 0n,
    newMrr = 0n,
    expansion = 0n,
    contraction = 0n,
    churn = 0n;
  let startCustomers = 0,
    endCustomers = 0,
    churnedCustomers = 0,
    newCustomers = 0;
  for (const id of new Set([...start.keys(), ...end.keys()])) {
    const a = start.get(id) ?? 0n,
      b = end.get(id) ?? 0n;
    startMrr += a;
    endMrr += b;
    if (a > 0n) startCustomers++;
    if (b > 0n) endCustomers++;
    if (a === 0n && b > 0n) {
      newMrr += b;
      newCustomers++;
    } else if (a > 0n && b === 0n) {
      churn += a;
      churnedCustomers++;
    } else if (b > a) expansion += b - a;
    else if (a > b) contraction += a - b;
  }
  // All financial arithmetic uses integers. Ratios are returned as fractions (0.95 = 95%).
  const ratio = (a: bigint, b: bigint) => (b === 0n ? null : Number(a) / Number(b));
  return {
    currency: input.currency,
    startingMrr: safe(startMrr),
    endingMrr: safe(endMrr),
    annualRunRate: safe(endMrr * 12n),
    newMrr: safe(newMrr),
    expansionMrr: safe(expansion),
    contractionMrr: safe(contraction),
    churnedMrr: safe(churn),
    netMrrChange: safe(endMrr - startMrr),
    startingCustomers: startCustomers,
    endingCustomers: endCustomers,
    newCustomers,
    churnedCustomers,
    netRevenueRetention: ratio(startMrr + expansion - contraction - churn, startMrr),
    grossRevenueRetention: ratio(startMrr - contraction - churn, startMrr),
    customerChurnRate: startCustomers ? churnedCustomers / startCustomers : null,
    averageRevenuePerCustomer: endCustomers ? rounded(endMrr, BigInt(endCustomers)) : null,
  };
}
