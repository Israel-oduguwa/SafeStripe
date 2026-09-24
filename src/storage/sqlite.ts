import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { BufferedTransaction } from './buffer.js';
import { BillingStorage, type StorageOptions } from './store.js';
import type { StorageDriver, AtomicTransaction, StoredRecord } from './contracts.js';
import type { Queue } from '../jobs.js';

class SQLiteDriver implements StorageDriver {
  readonly kind = 'sqlite';
  private readonly db: DatabaseSync;
  private tail: Promise<void> = Promise.resolve();
  constructor(filename: string) {
    if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
  }
  private async lock<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }
  async initialize() {
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS sf_records(key TEXT PRIMARY KEY, scope TEXT NOT NULL, queue TEXT NOT NULL, due_at REAL NOT NULL, record TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS sf_records_due ON sf_records(scope, queue, due_at, key);`);
  }
  private clock(): number {
    return Number(
      this.db.prepare("SELECT (julianday('now') - 2440587.5) * 86400000 AS ms").get()!.ms,
    );
  }
  now() {
    return this.lock(async () => this.clock());
  }
  private load(key: string): StoredRecord | undefined {
    const row = this.db.prepare('SELECT record FROM sf_records WHERE key = ?').get(key);
    return row ? (JSON.parse(String(row.record)) as StoredRecord) : undefined;
  }
  read(key: string) {
    return this.lock(async () => this.load(key));
  }
  transaction<T>(work: (tx: AtomicTransaction) => Promise<T>): Promise<T> {
    return this.lock(async () => {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const tx = new BufferedTransaction(this.clock(), async (key) => this.load(key));
        const result = await work(tx);
        const insert = this.db.prepare(
          'INSERT INTO sf_records(key,scope,queue,due_at,record) VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET scope=excluded.scope,queue=excluded.queue,due_at=excluded.due_at,record=excluded.record',
        );
        for (const row of tx.writes.values())
          insert.run(row.key, row.scope, row.queue, row.dueAt, JSON.stringify(row));
        this.db.exec('COMMIT');
        return result;
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    });
  }
  candidates(queue: Queue, scope: string, before: number, limit: number) {
    return this.lock(async () =>
      this.db
        .prepare(
          'SELECT key FROM sf_records WHERE scope=? AND queue=? AND due_at<=? ORDER BY due_at,key LIMIT ?',
        )
        .all(scope, queue, before, limit)
        .map((row) => String(row.key)),
    );
  }
  close() {
    return this.lock(async () => {
      this.db.close();
    });
  }
}
/** Local development / one process only. Never use a serverless filesystem as durable storage. */
export async function sqliteStorage(
  options: StorageOptions & { filename: string },
): Promise<BillingStorage> {
  const storage = new BillingStorage(new SQLiteDriver(options.filename), options);
  try {
    return await storage.initialize();
  } catch (error) {
    await storage.close();
    throw error;
  }
}
