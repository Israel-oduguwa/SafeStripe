export interface SqlResult {
  rows: Record<string, unknown>[];
  rowCount: number | null;
}
export interface Sql {
  query(text: string, values?: unknown[]): Promise<SqlResult>;
}
export interface Connection extends Sql {
  release(): void;
}
export interface Database extends Sql {
  connect(): Promise<Connection>;
}

export async function transaction<T>(db: Database, work: (tx: Sql) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* Preserve original error. */
    }
    throw error;
  } finally {
    client.release();
  }
}
