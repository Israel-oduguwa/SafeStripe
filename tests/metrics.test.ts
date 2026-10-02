import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateRevenueMetrics, monthlyRecurringAmount } from '../src/metrics.js';
const row = (customerId: string, monthlyAmount: number) => ({ customerId, monthlyAmount });
test('MRR movements reconcile and retention excludes new customers', () => {
  const m = calculateRevenueMetrics({
    currency: 'usd',
    start: [row('a', 10000), row('b', 5000), row('c', 5000)],
    end: [row('a', 15000), row('b', 3000), row('d', 10000)],
  });
  assert.equal(m.startingMrr, 20000);
  assert.equal(m.endingMrr, 28000);
  assert.equal(m.newMrr, 10000);
  assert.equal(m.expansionMrr, 5000);
  assert.equal(m.contractionMrr, 2000);
  assert.equal(m.churnedMrr, 5000);
  assert.equal(
    m.startingMrr + m.newMrr + m.expansionMrr - m.contractionMrr - m.churnedMrr,
    m.endingMrr,
  );
  assert.equal(m.netRevenueRetention, 0.9);
  assert.equal(m.grossRevenueRetention, 0.65);
  assert.equal(m.customerChurnRate, 1 / 3);
  assert.equal(m.annualRunRate, 336000);
  assert.equal(m.averageRevenuePerCustomer, 9333);
});
test('empty cohorts use null ratios; zero-dollar customers do not count as subscribers', () => {
  const m = calculateRevenueMetrics({
    currency: 'usd',
    start: [row('free', 0)],
    end: [row('new', 500)],
  });
  assert.equal(m.netRevenueRetention, null);
  assert.equal(m.customerChurnRate, null);
  assert.equal(m.startingCustomers, 0);
  assert.equal(m.newCustomers, 1);
});
test('annual, weekly and daily normalization uses documented rounding', () => {
  assert.equal(monthlyRecurringAmount({ amount: 12000, interval: 'year' }), 1000);
  assert.equal(monthlyRecurringAmount({ amount: 100, interval: 'week' }), 433);
  assert.equal(monthlyRecurringAmount({ amount: 100, interval: 'day' }), 3042);
  assert.equal(monthlyRecurringAmount({ amount: 101, interval: 'month', intervalCount: 2 }), 51);
});
test('rejects duplicate identities, invalid amounts, intervals and overflow', () => {
  assert.throws(
    () => calculateRevenueMetrics({ currency: 'usd', start: [row('a', 1), row('a', 2)], end: [] }),
    /unique/,
  );
  for (const n of [-1, NaN, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() =>
      calculateRevenueMetrics({ currency: 'usd', start: [row('a', n)], end: [] }),
    );
  assert.throws(
    () =>
      calculateRevenueMetrics({
        currency: 'usd',
        start: [],
        end: [row('a', Number.MAX_SAFE_INTEGER)],
      }),
    /range/,
  );
  assert.throws(() => monthlyRecurringAmount({ amount: 10, interval: 'quarter' as never }));
});
