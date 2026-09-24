import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import Stripe from 'stripe';
import type { Database, SqlResult } from '../src/database.js';
import { API_VERSION } from '../src/primitives.js';

export const scope = { platformAccountId: 'acct_platform', livemode: false };
export const actor = { tenantId: 'tenant-a', actorId: 'operator-a', operationId: 'order-1' };
// Synthetic offline fixture credentials; these cannot access a Stripe account.
export const secret = 'whsec_' + 'offlineOnlyFixture';
export const stripe = new Stripe('sk_test_' + 'offlineOnlyFixture', { apiVersion: API_VERSION });
export function event(id = 'evt_1', overrides: Record<string, unknown> = {}) {
  return {
    id,
    object: 'event',
    type: 'checkout.session.completed',
    api_version: API_VERSION,
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: 'cs_1', payment_status: 'paid', client_reference_id: 'order-1' } },
    ...overrides,
  };
}
export function signed(
  value = event(),
  signingSecret = secret,
  timestamp = Math.floor(Date.now() / 1000),
) {
  const payload = JSON.stringify(value);
  return {
    raw: Buffer.from(payload),
    signature: stripe.webhooks.generateTestHeaderString({
      payload,
      secret: signingSecret,
      timestamp,
    }),
  };
}
export async function testDatabase(): Promise<{
  db: Database;
  close(): Promise<void>;
  reset(): Promise<void>;
}> {
  const migration = await readFile(
    new URL('../migrations/001_initial.sql', import.meta.url),
    'utf8',
  );
  if (process.env.TEST_DATABASE_URL) {
    // A dedicated disposable database is required: reset truncates only SafeStripe tables.
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 12 });
    await pool.query(migration);
    return {
      db: pool,
      close: () => pool.end(),
      reset: async () => {
        await pool.query(
          'TRUNCATE sf_operations,sf_jobs,sf_effects,sf_audit,sf_projections,sf_balance_transactions',
        );
      },
    };
  }
  const pg = new PGlite();
  await pg.exec(migration);
  // PGlite has one connection. Serialize transactions and standalone queries faithfully.
  let tail = Promise.resolve();
  async function lock() {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    return release;
  }
  const query = async (sql: string, values?: unknown[]): Promise<SqlResult> => {
    const result =
      values === undefined
        ? (await pg.exec(sql)).at(-1)!
        : await pg.query<Record<string, unknown>>(sql, values);
    return { rows: result.rows, rowCount: result.rows.length || result.affectedRows || 0 };
  };
  const db: Database = {
    async query(sql, values) {
      const release = await lock();
      try {
        return await query(sql, values);
      } finally {
        release();
      }
    },
    async connect() {
      const release = await lock();
      return { query, release };
    },
  };
  return {
    db,
    close: () => pg.close(),
    reset: async () => {
      await pg.exec(
        'TRUNCATE sf_operations,sf_jobs,sf_effects,sf_audit,sf_projections,sf_balance_transactions',
      );
    },
  };
}
