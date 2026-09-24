import { canonical } from '../primitives.js';
import type { AtomicTransaction, StoredRecord } from './contracts.js';

/** Defers writes until all reads finish, including on Firestore's read-before-write protocol. */
export class BufferedTransaction implements AtomicTransaction {
  readonly dependencies = new Map<string, StoredRecord | undefined>();
  readonly writes = new Map<string, StoredRecord>();
  constructor(
    readonly now: number,
    private readonly load: (key: string) => Promise<StoredRecord | undefined>,
  ) {}
  async get(key: string): Promise<StoredRecord | undefined> {
    if (this.writes.has(key)) return structuredClone(this.writes.get(key));
    if (!this.dependencies.has(key)) this.dependencies.set(key, await this.load(key));
    return structuredClone(this.dependencies.get(key));
  }
  async put(record: StoredRecord): Promise<void> {
    // A read dependency is required even for a blind write to detect concurrent updates.
    await this.get(record.key);
    canonical(record);
    this.writes.set(record.key, structuredClone(record));
  }
}
