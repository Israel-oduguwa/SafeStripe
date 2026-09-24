#!/usr/bin/env node
import { Pool } from 'pg';
import { migrate } from './migrate.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || (args.length === 1 && ['--help', '-h'].includes(args[0]!))) {
    console.log(
      'Usage: safestripe migrate\nReads DATABASE_URL from the environment. Run with a migration database role.',
    );
    return;
  }
  if (args.length !== 1 || args[0] !== 'migrate') throw new Error('Use: safestripe migrate');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const db = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  db.on('error', () => {
    console.error('Migration database connection failed');
    process.exitCode = 1;
  });
  try {
    const applied = await migrate(db);
    console.log(
      applied.length ? `Applied: ${applied.join(', ')}` : 'SafeStripe schema is up to date',
    );
  } finally {
    await db.end();
  }
}
main().catch(() => {
  // Connection errors may contain credentials. Keep CLI output safe for CI logs.
  console.error(
    'Migration failed. Check DATABASE_URL, database access, schema locks and migration checksums. Use "safestripe --help" for usage.',
  );
  process.exitCode = 1;
});
