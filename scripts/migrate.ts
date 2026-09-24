import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { migrate } from '../src/migrate.js';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 5000,
});
try {
  const applied = await migrate(pool);
  console.log(
    applied.length ? `Applied: ${applied.join(', ')}` : 'SafeStripe schema is up to date',
  );
  if (process.argv.includes('--demo'))
    await pool.query(
      await readFile(new URL('../examples/shared/demo-schema.sql', import.meta.url), 'utf8'),
    );
} finally {
  await pool.end();
}
