import { randomUUID } from 'node:crypto';
import type { Database } from './database.js';
import { transaction } from './database.js';
import { SafeStripeError } from './errors.js';
import { integerOption } from './primitives.js';

export interface Operation {
  scope: string;
  tenantId: string;
  operationId: string;
  kind: string;
  fingerprint: string;
  key: string;
}
export type OperationClaim =
  { replay: true; resourceId: string } | { replay: false; token: string };

export class PostgresOperations {
  readonly leaseSeconds: number;
  readonly retryWindowSeconds: number;
  constructor(
    readonly db: Database,
    options: { leaseSeconds?: number; retryWindowSeconds?: number } = {},
  ) {
    this.leaseSeconds = integerOption(options.leaseSeconds ?? 120, 'leaseSeconds', 30, 3600);
    // Fail closed before Stripe can prune its idempotency cache (24h minimum).
    this.retryWindowSeconds = integerOption(
      options.retryWindowSeconds ?? 23 * 3600,
      'retryWindowSeconds',
      1,
      23 * 3600,
    );
  }
  async claim(op: Operation): Promise<OperationClaim> {
    const result = await transaction(this.db, async (tx) => {
      const token = randomUUID();
      const inserted = await tx.query(
        `INSERT INTO sf_operations
        (scope, tenant_id, operation_id, kind, fingerprint, idempotency_key, state, token, lease_until)
        VALUES ($1,$2,$3,$4,$5,$6,'running',$7,clock_timestamp()+$8*interval '1 second')
        ON CONFLICT DO NOTHING RETURNING operation_id`,
        [
          op.scope,
          op.tenantId,
          op.operationId,
          op.kind,
          op.fingerprint,
          op.key,
          token,
          this.leaseSeconds,
        ],
      );
      if (inserted.rowCount === 1) return { replay: false, token } as const;
      const { rows } = await tx.query(
        `SELECT *, lease_until > clock_timestamp() AS leased,
        created_at <= clock_timestamp()-$4*interval '1 second' AS expired
        FROM sf_operations WHERE scope=$1 AND tenant_id=$2 AND operation_id=$3 FOR UPDATE`,
        [op.scope, op.tenantId, op.operationId, this.retryWindowSeconds],
      );
      const row = rows[0]!;
      if (
        row.kind !== op.kind ||
        row.fingerprint !== op.fingerprint ||
        row.idempotency_key !== op.key
      ) {
        throw new SafeStripeError(
          'PAYLOAD_CONFLICT',
          'This operation ID is already bound to another request',
          409,
        );
      }
      if (row.state === 'succeeded')
        return { replay: true, resourceId: String(row.resource_id) } as const;
      if (row.state === 'review' || row.expired) {
        await tx.query(
          `UPDATE sf_operations SET state='review', updated_at=clock_timestamp() WHERE scope=$1 AND tenant_id=$2 AND operation_id=$3`,
          [op.scope, op.tenantId, op.operationId],
        );
        return 'review' as const;
      }
      if (row.state === 'running' && row.leased)
        throw new SafeStripeError('BUSY', 'Operation is in progress; retry the same ID later', 409);
      await tx.query(
        `UPDATE sf_operations SET state='running', token=$4,
        lease_until=clock_timestamp()+$5*interval '1 second', attempts=attempts+1, updated_at=clock_timestamp()
        WHERE scope=$1 AND tenant_id=$2 AND operation_id=$3`,
        [op.scope, op.tenantId, op.operationId, token, this.leaseSeconds],
      );
      return { replay: false, token } as const;
    });
    if (result === 'review')
      throw new SafeStripeError(
        'REVIEW_REQUIRED',
        'Reconcile the remote result before any further mutation',
        409,
      );
    return result;
  }
  async succeed(op: Operation, token: string, resourceId: string): Promise<void> {
    const result = await this.db.query(
      `UPDATE sf_operations SET state='succeeded',resource_id=$5,
      token=NULL,lease_until=NULL,error_code=NULL,updated_at=clock_timestamp()
      WHERE scope=$1 AND tenant_id=$2 AND operation_id=$3 AND token=$4 AND state='running'`,
      [op.scope, op.tenantId, op.operationId, token, resourceId],
    );
    if (result.rowCount !== 1)
      throw new SafeStripeError('LEASE_LOST', 'Another worker owns this operation', 409);
  }
  async retry(op: Operation, token: string): Promise<void> {
    await this.db.query(
      `UPDATE sf_operations SET state='retry',token=NULL,lease_until=NULL,
      error_code='UPSTREAM_OR_PERSISTENCE_FAILURE',updated_at=clock_timestamp()
      WHERE scope=$1 AND tenant_id=$2 AND operation_id=$3 AND token=$4 AND state='running'`,
      [op.scope, op.tenantId, op.operationId, token],
    );
  }
  /** Privileged recovery only: caller must verify resource ownership and Stripe request history first. */
  async resolveForReview(
    op: Pick<Operation, 'scope' | 'tenantId' | 'operationId'>,
    resourceId: string,
    actorId: string,
    reason: string,
  ): Promise<void> {
    if (!resourceId || !actorId || reason.trim().length < 10)
      throw new Error('Document the reviewed resource, actor and reason');
    await transaction(this.db, async (tx) => {
      const updated = await tx.query(
        `UPDATE sf_operations SET state='succeeded',resource_id=$4,
        token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE scope=$1 AND tenant_id=$2 AND operation_id=$3 AND state='review' RETURNING operation_id`,
        [op.scope, op.tenantId, op.operationId, resourceId],
      );
      if (updated.rowCount !== 1) throw new Error('Operation is not awaiting review');
      await tx.query(
        `INSERT INTO sf_audit (scope,subject_id,actor_id,action,reason) VALUES ($1,$2,$3,'resolve_operation',$4)`,
        [op.scope, `${op.tenantId}:${op.operationId}`, actorId, reason],
      );
    });
  }
}
