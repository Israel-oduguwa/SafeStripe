import type { Database, Sql } from '../database.js';
import { migrate } from '../migrate.js';
import { BufferedTransaction } from './buffer.js';
import { BillingStorage, type StorageOptions } from './store.js';
import type { StorageDriver, AtomicTransaction, StoredRecord } from './contracts.js';
import type { Queue } from '../jobs.js';

class PostgresDriver implements StorageDriver {
  readonly kind = 'postgres';
  constructor(
    private readonly db: Database,
    private readonly shouldMigrate: boolean,
  ) {}
  async initialize() {
    if (this.shouldMigrate) await migrate(this.db);
    await this.db.query('SELECT key FROM sf_records LIMIT 0');
  }
  private async clock(sql: Sql): Promise<number> {
    return Number(
      (await sql.query('SELECT extract(epoch FROM clock_timestamp()) * 1000 AS ms')).rows[0]!.ms,
    );
  }
  now() {
    return this.clock(this.db);
  }
  private async load(sql: Sql, key: string): Promise<StoredRecord | undefined> {
    return (await sql.query('SELECT record FROM sf_records WHERE key=$1', [key])).rows[0]
      ?.record as StoredRecord | undefined;
  }
  read(key: string) {
    return this.load(this.db, key);
  }
  async transaction<T>(work: (tx: AtomicTransaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const connection = await this.db.connect();
      try {
        await connection.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        await connection.query("SET LOCAL statement_timeout = '15s'");
        const tx = new BufferedTransaction(await this.clock(connection), (key) =>
          this.load(connection, key),
        );
        const result = await work(tx);
        for (const row of tx.writes.values())
          await connection.query(
            'INSERT INTO sf_records(key,scope,queue,due_at,record) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(key) DO UPDATE SET scope=excluded.scope,queue=excluded.queue,due_at=excluded.due_at,record=excluded.record',
            [row.key, row.scope, row.queue, row.dueAt, JSON.stringify(row)],
          );
        await connection.query('COMMIT');
        return result;
      } catch (error) {
        try {
          await connection.query('ROLLBACK');
        } catch {
          /* Preserve original failure. */
        }
        const code = (error as { code?: string }).code;
        if (attempt >= 5 || !['40001', '40P01', '23505'].includes(code ?? '')) throw error;
      } finally {
        connection.release();
      }
      await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 25));
    }
  }
  async candidates(queue: Queue, scope: string, before: number, limit: number) {
    return (
      await this.db.query(
        'SELECT key FROM sf_records WHERE scope=$1 AND queue=$2 AND due_at<=$3 ORDER BY due_at,key LIMIT $4',
        [scope, queue, before, limit],
      )
    ).rows.map((row) => String(row.key));
  }
  async close() {
    /* The application's pool belongs to the application. */
  }
}
/** Run migrations separately in production; migrate:true is useful for development. */
export async function postgresStorage(
  options: StorageOptions & { db: Database; migrate?: boolean },
): Promise<BillingStorage> {
  return new BillingStorage(
    new PostgresDriver(options.db, options.migrate ?? false),
    options,
  ).initialize();
}
