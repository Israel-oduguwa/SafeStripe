import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripeId } from '../src/primitives.js';

test('Billing Meter IDs support Stripe environment prefixes without accepting paths', () => {
  for (const value of [
    'mtr_test_61Q8nQMqIFK9fRQmr41CMAXJrFdZ5MnA',
    'mtr_live_61Q8nQMqIFK9fRQmr41CMAXJrFdZ5MnA',
    'mtr_fixture',
  ])
    assert.equal(stripeId('mtr').safeParse(value).success, true, value);
  for (const value of [
    'mtr_test_',
    'mtr_live_',
    'mtr_stage_abc',
    'mtr_test_abc/../cus_other',
    'mtr_test_abc?expand[]=customer',
    'mtr_test_abc\n',
    'mtr_test_' + 'a'.repeat(200),
    'cus_test_abc',
  ])
    assert.equal(stripeId('mtr').safeParse(value).success, false, value);
});

test('environment segments in meter IDs do not relax unrelated resource validation', () => {
  for (const prefix of ['cus', 'price', 'acct', 'sub', 'in', 'pi', 'si', 'qt', 'clock']) {
    assert.equal(stripeId(prefix).safeParse(`${prefix}_valid123`).success, true);
    assert.equal(stripeId(prefix).safeParse(`${prefix}_test_abc`).success, false);
    assert.equal(stripeId(prefix).safeParse(`${prefix}_abc/other`).success, false);
  }
});
