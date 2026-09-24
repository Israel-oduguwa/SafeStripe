import { randomUUID } from 'node:crypto';
import { canonical, digest, identifier, integerOption, parse } from '../primitives.js';
import { SafeStripeError } from '../errors.js';
import type { Operation, OperationClaim } from '../operations.js';
import type { Job, Queue } from '../jobs.js';
import type {
  AtomicTransaction,
  BillingTransaction,
  OperationStore,
  StorageDriver,
  StoredRecord,
  JobStore,
} from './contracts.js';

const NEVER = Number.MAX_SAFE_INTEGER;
const MAX_BYTES = 512_000;
const keyFor = (...parts: string[]) => digest(parts);
function checkId(value: string): string {
  return parse(identifier, value);
}
function jsonValue(value: unknown): Record<string, unknown> {
  const json = canonical({ data: value });
  if (Buffer.byteLength(json) > MAX_BYTES)
    throw new SafeStripeError(
      'BODY_TOO_LARGE',
      'Stored data exceeds the adapter payload limit',
      413,
    );
  return JSON.parse(json) as Record<string, unknown>;
}
function record(
  kind: StoredRecord['kind'],
  scope: string,
  key: string,
  value: Record<string, unknown>,
  queue = '',
  dueAt = NEVER,
): StoredRecord {
  return { kind, scope, key, value, queue, dueAt };
}
function sameOperation(row: StoredRecord, op: Operation): void {
  if (
    row.value.kind !== op.kind ||
    row.value.fingerprint !== op.fingerprint ||
    row.value.key !== op.key
  )
    throw new SafeStripeError(
      'PAYLOAD_CONFLICT',
      'Operation identity is already bound to different inputs',
      409,
    );
}

export interface StorageOptions {
  leaseSeconds?: number;
  retryWindowSeconds?: number;
  maxAttempts?: number;
}
export class BillingStorage {
  readonly operations: DocumentOperations;
  readonly jobs: DocumentJobs;
  readonly maxPayloadBytes = MAX_BYTES;
  constructor(
    readonly driver: StorageDriver,
    options: StorageOptions = {},
  ) {
    this.operations = new DocumentOperations(driver, options);
    this.jobs = new DocumentJobs(driver, options);
  }
  get kind() {
    return this.driver.kind;
  }
  async initialize(): Promise<this> {
    await this.driver.initialize();
    return this;
  }
  async read<T>(scope: string, collection: string, id: string): Promise<T | undefined> {
    const row = await this.driver.read(keyFor('data', scope, checkId(collection), checkId(id)));
    return row?.value.data as T | undefined;
  }
  async transaction<T>(scope: string, work: (tx: BillingTransaction) => Promise<T>): Promise<T> {
    return this.driver.transaction((tx) =>
      work(new DocumentContext(this.driver, tx, scope, this.jobs)),
    );
  }
  close(): Promise<void> {
    return this.driver.close();
  }
}

export class DocumentOperations implements OperationStore {
  readonly leaseSeconds: number;
  readonly retryWindowSeconds: number;
  constructor(
    private readonly driver: StorageDriver,
    options: StorageOptions = {},
  ) {
    this.leaseSeconds = integerOption(options.leaseSeconds ?? 120, 'leaseSeconds', 30, 3600);
    this.retryWindowSeconds = integerOption(
      options.retryWindowSeconds ?? 82_800,
      'retryWindowSeconds',
      1,
      82_800,
    );
  }
  private key(op: Pick<Operation, 'scope' | 'tenantId' | 'operationId'>) {
    return keyFor('operation', op.scope, op.tenantId, op.operationId);
  }
  async claim(op: Operation): Promise<OperationClaim> {
    const result = await this.driver.transaction(async (tx) => {
      const key = this.key(op);
      const row = await tx.get(key);
      if (row) {
        sameOperation(row, op);
        if (row.value.state === 'succeeded')
          return { replay: true, resourceId: String(row.value.resourceId) } as const;
        if (
          row.value.state === 'review' ||
          Number(row.value.createdAt) <= tx.now - this.retryWindowSeconds * 1000
        ) {
          row.value.state = 'review';
          row.value.updatedAt = tx.now;
          await tx.put(row);
          return 'review' as const;
        }
        if (row.value.state === 'running' && Number(row.value.leaseUntil) > tx.now)
          throw new SafeStripeError(
            'BUSY',
            'Operation is in progress; retry the same identity',
            409,
          );
      }
      const token = randomUUID();
      await tx.put(
        record('operation', op.scope, key, {
          kind: op.kind,
          fingerprint: op.fingerprint,
          key: op.key,
          state: 'running',
          token,
          createdAt: row?.value.createdAt ?? tx.now,
          updatedAt: tx.now,
          leaseUntil: tx.now + this.leaseSeconds * 1000,
          attempts: Number(row?.value.attempts ?? 0) + 1,
        }),
      );
      return { replay: false, token } as const;
    });
    if (result === 'review')
      throw new SafeStripeError(
        'REVIEW_REQUIRED',
        'Reconcile the remote result before another mutation',
        409,
      );
    return result;
  }
  async succeed(op: Operation, token: string, resourceId: string): Promise<void> {
    await this.driver.transaction(async (tx) => {
      const row = await tx.get(this.key(op));
      if (!row || row.value.state !== 'running' || row.value.token !== token)
        throw new SafeStripeError('LEASE_LOST', 'Operation ownership changed', 409);
      row.value = {
        ...row.value,
        state: 'succeeded',
        resourceId,
        token: null,
        leaseUntil: null,
        updatedAt: tx.now,
      };
      await tx.put(row);
    });
  }
  async retry(op: Operation, token: string): Promise<void> {
    await this.driver.transaction(async (tx) => {
      const row = await tx.get(this.key(op));
      if (!row || row.value.state !== 'running' || row.value.token !== token) return;
      row.value = {
        ...row.value,
        state: 'retry',
        token: null,
        leaseUntil: null,
        updatedAt: tx.now,
      };
      await tx.put(row);
    });
  }
  async inspect(op: Pick<Operation, 'scope' | 'tenantId' | 'operationId'>) {
    return (await this.driver.read(this.key(op)))?.value;
  }
  /** Privileged recovery. Verify the remote resource and commercial terms before calling. */
  async resolveForReview(
    op: Pick<Operation, 'scope' | 'tenantId' | 'operationId'>,
    resourceId: string,
    actorId: string,
    reason: string,
  ): Promise<void> {
    checkId(resourceId);
    checkId(actorId);
    if (reason.trim().length < 10 || reason.length > 2000)
      throw new SafeStripeError('INVALID_INPUT', 'A review reason is required');
    await this.driver.transaction(async (tx) => {
      const row = await tx.get(this.key(op));
      if (!row || row.value.state !== 'review')
        throw new SafeStripeError('INVALID_INPUT', 'Operation is not awaiting review');
      row.value = {
        ...row.value,
        state: 'succeeded',
        resourceId,
        token: null,
        leaseUntil: null,
        updatedAt: tx.now,
      };
      await tx.put(row);
      await tx.put(
        record('audit', op.scope, keyFor('audit', randomUUID()), {
          action: 'resolve_operation',
          subject: this.key(op),
          actorId,
          reason,
          createdAt: tx.now,
        }),
      );
    });
  }
}

export class DocumentJobs implements JobStore<BillingTransaction> {
  readonly leaseSeconds: number;
  readonly maxAttempts: number;
  constructor(
    private readonly driver: StorageDriver,
    options: StorageOptions = {},
  ) {
    this.leaseSeconds = integerOption(options.leaseSeconds ?? 120, 'leaseSeconds', 1, 3600);
    this.maxAttempts = integerOption(options.maxAttempts ?? 8, 'maxAttempts', 1, 100);
  }
  private key(queue: Queue, scope: string, id: string) {
    return keyFor('job', queue, scope, id);
  }
  async enqueue(
    queue: Queue,
    scope: string,
    id: string,
    type: string,
    payload: unknown,
    context?: BillingTransaction,
  ): Promise<boolean> {
    checkId(id);
    checkId(type);
    const value = jsonValue(payload).data;
    const save = async (tx: AtomicTransaction) => {
      const key = this.key(queue, scope, id);
      const existing = await tx.get(key);
      if (existing) {
        if (
          queue === 'outbox' &&
          (existing.value.type !== type || canonical(existing.value.payload) !== canonical(value))
        )
          throw new SafeStripeError(
            'PAYLOAD_CONFLICT',
            'Outbox identity is already bound to another message',
            409,
          );
        return false;
      }
      await tx.put(
        record(
          'job',
          scope,
          key,
          {
            id,
            type,
            payload: value,
            state: 'pending',
            attempts: 0,
            createdAt: tx.now,
            token: null,
          },
          queue,
          tx.now,
        ),
      );
      return true;
    };
    if (context) {
      if (
        !(context instanceof DocumentContext) ||
        context.driver !== this.driver ||
        context.scope !== scope
      )
        throw new SafeStripeError(
          'INVALID_INPUT',
          'Outbox transaction belongs to another store or scope',
        );
      return save(context.atomic);
    }
    return this.driver.transaction(save);
  }
  async claim(queue: Queue, scope: string): Promise<Job | null> {
    const candidates = await this.driver.candidates(queue, scope, await this.driver.now(), 20);
    for (const key of candidates) {
      const claimed = await this.driver.transaction(async (tx) => {
        const row = await tx.get(key);
        if (
          !row ||
          row.scope !== scope ||
          row.queue !== queue ||
          row.dueAt > tx.now ||
          !['pending', 'running'].includes(String(row.value.state))
        )
          return null;
        if (Number(row.value.attempts) >= this.maxAttempts) {
          row.value = { ...row.value, state: 'dead', token: null, errorCode: 'ATTEMPTS_EXHAUSTED' };
          row.dueAt = NEVER;
          await tx.put(row);
          return null;
        }
        const token = randomUUID();
        const attempts = Number(row.value.attempts) + 1;
        row.value = { ...row.value, state: 'running', token, attempts };
        row.dueAt = tx.now + this.leaseSeconds * 1000;
        await tx.put(row);
        return {
          queue,
          scope,
          id: String(row.value.id),
          type: String(row.value.type),
          payload: row.value.payload,
          token,
          attempts,
        };
      });
      if (claimed) return claimed;
    }
    return null;
  }
  async complete(job: Job, work: (tx: BillingTransaction) => Promise<void>): Promise<void> {
    await this.driver.transaction(async (tx) => {
      const row = await tx.get(this.key(job.queue, job.scope, job.id));
      if (
        !row ||
        row.value.state !== 'running' ||
        row.value.token !== job.token ||
        row.dueAt <= tx.now
      )
        throw new SafeStripeError('LEASE_LOST', 'Job ownership expired or changed', 409);
      await work(new DocumentContext(this.driver, tx, job.scope, this));
      row.value = { ...row.value, state: 'done', token: null, finishedAt: tx.now, errorCode: null };
      row.dueAt = NEVER;
      await tx.put(row);
    });
  }
  async fail(job: Job, permanent = false): Promise<void> {
    await this.driver.transaction(async (tx) => {
      const row = await tx.get(this.key(job.queue, job.scope, job.id));
      if (!row || row.value.state !== 'running' || row.value.token !== job.token) return;
      const dead = permanent || Number(row.value.attempts) >= this.maxAttempts;
      const delay = Math.min(300, 2 ** Math.min(job.attempts, 8)) * (0.5 + Math.random() * 0.5);
      row.value = {
        ...row.value,
        state: dead ? 'dead' : 'pending',
        token: null,
        errorCode: 'HANDLER_FAILED',
      };
      row.dueAt = dead ? NEVER : tx.now + delay * 1000;
      await tx.put(row);
    });
  }
  async inspect(queue: Queue, scope: string, id: string) {
    return (await this.driver.read(this.key(queue, scope, id)))?.value;
  }
  /** Authenticate the operator and authorize the scope before invoking this method. */
  async replayDead(
    queue: Queue,
    scope: string,
    id: string,
    actorId: string,
    reason: string,
  ): Promise<void> {
    checkId(actorId);
    if (reason.trim().length < 10 || reason.length > 2000)
      throw new SafeStripeError('INVALID_INPUT', 'A review reason is required');
    await this.driver.transaction(async (tx) => {
      const row = await tx.get(this.key(queue, scope, id));
      if (!row || row.value.state !== 'dead')
        throw new SafeStripeError('INVALID_INPUT', 'Job is not dead');
      row.value = { ...row.value, state: 'pending', attempts: 0, token: null, errorCode: null };
      row.dueAt = tx.now;
      await tx.put(row);
      await tx.put(
        record('audit', scope, keyFor('audit', randomUUID()), {
          action: 'replay_dead',
          subject: row.key,
          actorId,
          reason,
          createdAt: tx.now,
        }),
      );
    });
  }
}

class DocumentContext implements BillingTransaction {
  constructor(
    readonly driver: StorageDriver,
    readonly atomic: AtomicTransaction,
    readonly scope: string,
    private readonly jobs: DocumentJobs,
  ) {}
  get now() {
    return this.atomic.now;
  }
  async get<T>(collection: string, id: string): Promise<T | undefined> {
    return (await this.atomic.get(keyFor('data', this.scope, checkId(collection), checkId(id))))
      ?.value.data as T | undefined;
  }
  async set(collection: string, id: string, value: unknown): Promise<void> {
    await this.atomic.put(
      record(
        'data',
        this.scope,
        keyFor('data', this.scope, checkId(collection), checkId(id)),
        jsonValue(value),
      ),
    );
  }
  async effectOnce(key: string, work: (tx: BillingTransaction) => Promise<void>): Promise<boolean> {
    checkId(key);
    const id = keyFor('effect', this.scope, key);
    if (await this.atomic.get(id)) return false;
    await this.atomic.put(
      record('effect', this.scope, id, { effectKey: key, createdAt: this.now }),
    );
    await work(this);
    return true;
  }
  enqueue(id: string, type: string, payload: unknown): Promise<boolean> {
    return this.jobs.enqueue('outbox', this.scope, id, type, payload, this);
  }
}
