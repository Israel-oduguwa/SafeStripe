import { migrationSources } from './migration-sources.js';
import { createHash } from 'node:crypto';
import type { Database } from './database.js';
import { transaction } from './database.js';
import { integerOption } from './primitives.js';

export interface MigrationOptions {
  /** Maximum wait for another migration runner or a conflicting schema lock. */
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
}

/** Run once per deployment with a DDL-capable role, before starting application workers. */
export async function migrate(db: Database, options: MigrationOptions = {}): Promise<string[]> {
  const lockTimeout = integerOption(options.lockTimeoutMs ?? 10_000, 'lockTimeoutMs', 1, 300_000);
  const statementTimeout = integerOption(
    options.statementTimeoutMs ?? 60_000,
    'statementTimeoutMs',
    1,
    3_600_000,
  );
  const migrations = migrationSources.map(({ name, sql }) => ({
    name,
    sql,
    checksum: createHash('sha256').update(sql).digest('hex'),
  }));
  if (!migrations.length)
    throw new Error('No SafeStripe migrations found in the installed package');
  return transaction(db, async (tx) => {
    await tx.query(
      "SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true)",
      [String(lockTimeout), String(statementTimeout)],
    );
    await tx.query('SELECT pg_advisory_xact_lock(781443, 1)');
    await tx.query(
      'CREATE TABLE IF NOT EXISTS sf_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT clock_timestamp())',
    );
    const applied = await tx.query('SELECT name,checksum FROM sf_migrations ORDER BY name');
    const known = new Map<string, string>(migrations.map((m) => [m.name, m.checksum]));
    for (const row of applied.rows) {
      if (known.get(String(row.name)) !== row.checksum)
        throw new Error(`Unknown or modified applied migration: ${String(row.name)}`);
    }
    const existing = new Set(applied.rows.map((row) => String(row.name)));
    const changed: string[] = [];
    for (const migration of migrations) {
      if (existing.has(migration.name)) continue;
      await tx.query(migration.sql);
      await tx.query('INSERT INTO sf_migrations(name,checksum) VALUES($1,$2)', [
        migration.name,
        migration.checksum,
      ]);
      changed.push(migration.name);
    }
    return changed;
  });
}
