import type { Operation, OperationClaim } from '../operations.js';
import type { Job, Queue } from '../jobs.js';

export interface OperationStore {
  claim(operation: Operation): Promise<OperationClaim>;
  succeed(operation: Operation, token: string, resourceId: string): Promise<void>;
  retry(operation: Operation, token: string): Promise<void>;
}
export interface JobIngress {
  enqueue(
    queue: Queue,
    scope: string,
    id: string,
    type: string,
    payload: unknown,
  ): Promise<boolean>;
}
export interface JobStore<T> extends JobIngress {
  claim(queue: Queue, scope: string): Promise<Job | null>;
  complete(job: Job, work: (transaction: T) => Promise<void>): Promise<void>;
  fail(job: Job, permanent?: boolean): Promise<void>;
}

/** Callbacks may be retried by the database. Use only transaction writes and bounded reads. */
export interface BillingTransaction {
  readonly scope: string;
  readonly now: number;
  get<T>(collection: string, id: string): Promise<T | undefined>;
  set(collection: string, id: string, value: unknown): Promise<void>;
  effectOnce(key: string, work: (tx: BillingTransaction) => Promise<void>): Promise<boolean>;
  enqueue(id: string, type: string, payload: unknown): Promise<boolean>;
}

/** Private adapter protocol: records are read and written in a serializable transaction. */
export interface StoredRecord {
  key: string;
  kind: 'operation' | 'job' | 'effect' | 'audit' | 'data';
  scope: string;
  queue: string;
  dueAt: number;
  value: Record<string, unknown>;
}
export interface AtomicTransaction {
  readonly now: number;
  get(key: string): Promise<StoredRecord | undefined>;
  put(record: StoredRecord): Promise<void>;
}
export interface StorageDriver {
  readonly kind: 'sqlite' | 'postgres' | 'mongodb' | 'firestore';
  initialize(): Promise<void>;
  now(): Promise<number>;
  transaction<T>(work: (tx: AtomicTransaction) => Promise<T>): Promise<T>;
  read(key: string): Promise<StoredRecord | undefined>;
  candidates(queue: Queue, scope: string, before: number, limit: number): Promise<string[]>;
  close(): Promise<void>;
}
