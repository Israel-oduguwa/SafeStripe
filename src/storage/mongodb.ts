import { randomUUID } from 'node:crypto';
import type { MongoClient, Collection } from 'mongodb';
import { BufferedTransaction } from './buffer.js';
import { BillingStorage, type StorageOptions } from './store.js';
import type { StorageDriver, AtomicTransaction, StoredRecord } from './contracts.js';
import type { Queue } from '../jobs.js';

type Document = Partial<StoredRecord> & { _id: string; _revision: string; _missing?: boolean };
class MongoDriver implements StorageDriver {
  readonly kind = 'mongodb';
  private readonly collection: Collection<Document>;
  constructor(
    private readonly client: MongoClient,
    private readonly database: string,
    collection: string,
  ) {
    this.collection = client.db(database).collection<Document>(collection);
  }
  async initialize() {
    const hello = await this.client.db(this.database).command({ hello: 1 });
    if (!hello.setName && hello.msg !== 'isdbgrid')
      throw new Error('SafeStripe requires MongoDB transactions: use Atlas or a replica set');
    await this.collection.createIndex(
      { scope: 1, queue: 1, dueAt: 1, _id: 1 },
      { name: 'safestripe_due' },
    );
  }
  async now() {
    return new Date(
      (await this.client.db(this.database).command({ hello: 1 })).localTime,
    ).getTime();
  }
  private decode(row: Document | null): StoredRecord | undefined {
    if (!row || row._missing) return undefined;
    const { _id, _revision, _missing, ...data } = row;
    return data as StoredRecord;
  }
  async read(key: string) {
    return this.decode(await this.collection.findOne({ _id: key }));
  }
  async transaction<T>(work: (tx: AtomicTransaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const session = this.client.startSession();
      try {
        return await session.withTransaction(
          async () => {
            const tx = new BufferedTransaction(await this.now(), async (key) =>
              this.decode(await this.collection.findOne({ _id: key }, { session })),
            );
            const result = await work(tx);
            // Force a write conflict on EVERY read dependency, including missing documents.
            // This prevents snapshot-isolation write skew across business records.
            for (const [key, value] of tx.dependencies) {
              const row = tx.writes.get(key) ?? value;
              await this.collection.replaceOne(
                { _id: key },
                { ...(row ?? {}), _revision: randomUUID(), _missing: !row },
                { upsert: true, session },
              );
            }
            return result;
          },
          {
            readConcern: { level: 'snapshot' },
            writeConcern: { w: 'majority' },
            readPreference: 'primary',
            timeoutMS: 30_000,
          },
        );
      } catch (error) {
        // Concurrent insertion of a previously missing dependency can report a duplicate key.
        if ((error as { code?: number }).code !== 11000 || attempt >= 5) throw error;
      } finally {
        await session.endSession();
      }
    }
  }
  async candidates(queue: Queue, scope: string, before: number, limit: number) {
    return (
      await this.collection
        .find({ scope, queue, dueAt: { $lte: before } }, { projection: { _id: 1 } })
        .sort({ dueAt: 1, _id: 1 })
        .limit(limit)
        .toArray()
    ).map((row) => row._id);
  }
  async close() {
    /* The application's MongoClient belongs to the application. */
  }
}
export async function mongoStorage(
  options: StorageOptions & { client: MongoClient; database: string; collection?: string },
): Promise<BillingStorage> {
  return new BillingStorage(
    new MongoDriver(options.client, options.database, options.collection ?? 'safestripe_records'),
    options,
  ).initialize();
}
