import type { Firestore, CollectionReference } from '@google-cloud/firestore';
import { BufferedTransaction } from './buffer.js';
import { BillingStorage, type StorageOptions } from './store.js';
import type { StorageDriver, AtomicTransaction, StoredRecord } from './contracts.js';
import type { Queue } from '../jobs.js';

class FirestoreDriver implements StorageDriver {
  readonly kind = 'firestore';
  private readonly collection: CollectionReference;
  constructor(
    private readonly db: Firestore,
    collection: string,
  ) {
    this.collection = db.collection(collection);
  }
  async initialize() {
    await this.collection.doc('_clock').get();
  }
  async now() {
    return (await this.collection.doc('_clock').get()).readTime.toMillis();
  }
  async read(key: string) {
    return (await this.collection.doc(key).get()).data() as StoredRecord | undefined;
  }
  transaction<T>(work: (tx: AtomicTransaction) => Promise<T>): Promise<T> {
    return this.db.runTransaction(
      async (transaction) => {
        const time = (await transaction.get(this.collection.doc('_clock'))).readTime.toMillis();
        const tx = new BufferedTransaction(
          time,
          async (key) =>
            (await transaction.get(this.collection.doc(key))).data() as StoredRecord | undefined,
        );
        const result = await work(tx);
        for (const row of tx.writes.values()) transaction.set(this.collection.doc(row.key), row);
        return result;
      },
      { maxAttempts: 6 },
    );
  }
  async candidates(queue: Queue, scope: string, before: number, limit: number) {
    const snapshot = await this.collection
      .where('scope', '==', scope)
      .where('queue', '==', queue)
      .where('dueAt', '<=', before)
      .orderBy('dueAt')
      .limit(limit)
      .get();
    return snapshot.docs.map((doc) => doc.id);
  }
  async close() {
    /* The application's Firestore client belongs to the application. */
  }
}
/** Use the server SDK with IAM credentials. Never expose this collection to browser clients. */
export async function firestoreStorage(
  options: StorageOptions & { db: Firestore; collection?: string },
): Promise<BillingStorage> {
  return new BillingStorage(
    new FirestoreDriver(options.db, options.collection ?? 'safestripe_records'),
    options,
  ).initialize();
}
