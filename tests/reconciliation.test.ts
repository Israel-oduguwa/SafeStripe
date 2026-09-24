import { test } from 'node:test';
import assert from 'node:assert/strict';
import type Stripe from 'stripe';
import { importBalanceTransactions, reconcile } from '../src/index.js';
import { scope, testDatabase } from './helpers.js';

test('reconciliation separates missing, unexpected and mismatched entries using exact integers', () => {
  const result = reconcile(
    [
      { id: 'txn_a', currency: 'usd', net: 9007199254740993n },
      { id: 'txn_b', currency: 'usd', net: 10n },
    ],
    [
      { id: 'txn_a', currency: 'eur', net: 9007199254740993n },
      { id: 'txn_c', currency: 'usd', net: 10n },
    ],
  );
  assert.deepEqual(result, {
    matched: false,
    missing: ['txn_b'],
    unexpected: ['txn_c'],
    mismatched: ['txn_a'],
  });
});
test('duplicate source IDs cannot be silently collapsed during reconciliation', () => {
  const item = { id: 'txn_a', currency: 'usd', net: 100n };
  assert.throws(() => reconcile([item, item], []));
  assert.equal(reconcile([item], [item]).matched, true);
});
test('balance import is repeatable, scoped and refreshes settlement availability', async () => {
  const harness = await testDatabase();
  await harness.reset();
  let status = 'pending';
  const sdk = {
    balanceTransactions: {
      list(params: unknown, options: Stripe.RequestOptions) {
        assert.deepEqual(params, { created: { gte: 100, lt: 200 }, limit: 100 });
        assert.equal(options.stripeAccount, 'acct_seller');
        return (async function* () {
          yield {
            id: 'txn_a',
            currency: 'usd',
            amount: 1000,
            fee: 50,
            net: 950,
            created: 150,
            available_on: 200,
            status,
            source: 'ch_a',
            type: 'charge',
          };
        })();
      },
    },
  } as unknown as Stripe;
  try {
    const input = {
      stripe: sdk,
      db: harness.db,
      scope: { ...scope, connectedAccountId: 'acct_seller' },
      from: 100,
      to: 200,
    };
    assert.equal(await importBalanceTransactions(input), 1);
    status = 'available';
    await importBalanceTransactions(input);
    const { rows } = await harness.db.query('SELECT status,net FROM sf_balance_transactions');
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.status, 'available');
    assert.equal(BigInt(String(rows[0]!.net)), 950n);
  } finally {
    await harness.close();
  }
});
