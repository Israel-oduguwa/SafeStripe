import { randomUUID } from 'node:crypto';
import type { Database, Sql } from './database.js';
import { transaction } from './database.js';
import { SafeStripeError } from './errors.js';
import { canonical, digest, integerOption } from './primitives.js';

export type Queue = 'webhook' | 'outbox';
export interface Job {
  queue: Queue;
  scope: string;
  id: string;
  type: string;
  payload: unknown;
  token: string;
  attempts: number;
}
export class PostgresJobs {
  readonly leaseSeconds: number;
  readonly maxAttempts: number;
  constructor(
    readonly db: Database,
    options: { leaseSeconds?: number; maxAttempts?: number } = {},
  ) {
    this.leaseSeconds = integerOption(options.leaseSeconds ?? 120, 'leaseSeconds', 1, 3600);
    this.maxAttempts = integerOption(options.maxAttempts ?? 8, 'maxAttempts', 1, 100);
  }
  async enqueue(
    queue: Queue,
    scope: string,
    id: string,
    type: string,
    payload: unknown,
    tx: Sql = this.db,
  ): Promise<boolean> {
    const result = await tx.query(
      `INSERT INTO sf_jobs(queue,scope,id,type,payload) VALUES($1,$2,$3,$4,$5::jsonb)
      ON CONFLICT DO NOTHING RETURNING id`,
      [queue, scope, id, type, canonical(payload)],
    );
    if (queue === 'outbox' && result.rowCount !== 1) {
      const existing = await tx.query(
        `SELECT id FROM sf_jobs WHERE queue=$1 AND scope=$2 AND id=$3 AND type=$4 AND payload=$5::jsonb`,
        [queue, scope, id, type, canonical(payload)],
      );
      if (!existing.rows.length)
        throw new SafeStripeError('PAYLOAD_CONFLICT', 'Outbox ID is bound to another payload', 409);
    }
    return result.rowCount === 1;
  }
  async claim(queue: Queue, scope: string): Promise<Job | null> {
    // Crashing on the final attempt must still produce a visible dead letter.
    await this.db.query(
      `WITH exhausted AS (
      SELECT queue,scope,id FROM sf_jobs WHERE queue=$1 AND scope=$2 AND attempts >= $3
      AND ((state='running' AND lease_until <= clock_timestamp()) OR state='pending')
      ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 100
    ) UPDATE sf_jobs j SET state='dead',token=NULL,lease_until=NULL,error_code='ATTEMPTS_EXHAUSTED'
      FROM exhausted e WHERE j.queue=e.queue AND j.scope=e.scope AND j.id=e.id`,
      [queue, scope, this.maxAttempts],
    );
    const { rows } = await this.db.query(
      `WITH candidate AS (
      SELECT queue,scope,id FROM sf_jobs WHERE queue=$1 AND scope=$2 AND attempts < $3
      AND ((state='pending' AND available_at <= clock_timestamp()) OR (state='running' AND lease_until <= clock_timestamp()))
      ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE sf_jobs j SET state='running',attempts=j.attempts+1,token=$4,
      lease_until=clock_timestamp()+$5*interval '1 second'
      FROM candidate c WHERE j.queue=c.queue AND j.scope=c.scope AND j.id=c.id RETURNING j.*`,
      [queue, scope, this.maxAttempts, randomUUID(), this.leaseSeconds],
    );
    if (!rows[0]) return null;
    const row = rows[0];
    return {
      queue,
      scope,
      id: String(row.id),
      type: String(row.type),
      payload: row.payload,
      token: String(row.token),
      attempts: Number(row.attempts),
    };
  }
  /** All handler database writes and the done marker commit or roll back together. */
  async complete(job: Job, work: (tx: Sql) => Promise<void>): Promise<void> {
    await transaction(this.db, async (tx) => {
      const result = await tx.query(
        `SELECT id FROM sf_jobs WHERE queue=$1 AND scope=$2 AND id=$3 AND token=$4
        AND state='running' AND lease_until > clock_timestamp() FOR UPDATE`,
        [job.queue, job.scope, job.id, job.token],
      );
      if (result.rowCount !== 1)
        throw new SafeStripeError('LEASE_LOST', 'Job lease expired or was reassigned', 409);
      await work(tx);
      await tx.query(
        `UPDATE sf_jobs SET state='done',finished_at=clock_timestamp(),token=NULL,lease_until=NULL,error_code=NULL
        WHERE queue=$1 AND scope=$2 AND id=$3 AND token=$4`,
        [job.queue, job.scope, job.id, job.token],
      );
    });
  }
  async fail(job: Job, permanent = false): Promise<void> {
    // Exponential backoff + jitter, bounded to five minutes. Only a stable code is stored.
    const delay = Math.min(300, 2 ** Math.min(job.attempts, 8)) * (0.5 + Math.random() * 0.5);
    await this.db.query(
      `UPDATE sf_jobs SET state=$5,available_at=clock_timestamp()+$6*interval '1 second',
      token=NULL,lease_until=NULL,error_code='HANDLER_FAILED'
      WHERE queue=$1 AND scope=$2 AND id=$3 AND token=$4 AND state='running'`,
      [
        job.queue,
        job.scope,
        job.id,
        job.token,
        permanent || job.attempts >= this.maxAttempts ? 'dead' : 'pending',
        delay,
      ],
    );
  }
  /** Internal operator action. Authenticate and authorize before exposing through any admin API. */
  async replayDead(
    queue: Queue,
    scope: string,
    id: string,
    actorId: string,
    reason: string,
  ): Promise<void> {
    if (!actorId || reason.trim().length < 10)
      throw new Error('An operator identity and review reason are required');
    await transaction(this.db, async (tx) => {
      const result = await tx.query(
        `UPDATE sf_jobs SET state='pending',attempts=0,available_at=clock_timestamp(),
        token=NULL,lease_until=NULL,error_code=NULL WHERE queue=$1 AND scope=$2 AND id=$3 AND state='dead' RETURNING id`,
        [queue, scope, id],
      );
      if (result.rowCount !== 1) throw new Error('Job is not dead');
      await tx.query(
        `INSERT INTO sf_audit(scope,subject_id,actor_id,action,reason) VALUES($1,$2,$3,'replay_dead',$4)`,
        [scope, `${queue}:${id}`, actorId, reason],
      );
    });
  }
}

/** The key names a business effect (e.g. tenant:order:fulfill), never just an event. */
export async function effectOnce(
  tx: Sql,
  scope: string,
  effectKey: string,
  work: () => Promise<void>,
): Promise<boolean> {
  const result = await tx.query(
    `INSERT INTO sf_effects(scope,effect_key) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING effect_key`,
    [scope, effectKey],
  );
  if (result.rowCount !== 1) return false;
  await work();
  return true;
}

export function outboxDeliveryKey(job: Job): string {
  return `sf_out_${digest([job.scope, job.id])}`;
}

/** Serializes current-state retrieval and projection update across workers for one resource. */
export async function refreshProjection(
  tx: Sql,
  scope: string,
  resourceId: string,
  fetchCurrent: () => Promise<unknown>,
): Promise<void> {
  await tx.query(
    `INSERT INTO sf_projections(scope,resource_id,payload) VALUES($1,$2,'{}') ON CONFLICT DO NOTHING`,
    [scope, resourceId],
  );
  await tx.query(
    `SELECT resource_id FROM sf_projections WHERE scope=$1 AND resource_id=$2 FOR UPDATE`,
    [scope, resourceId],
  );
  const current = await fetchCurrent();
  await tx.query(
    `UPDATE sf_projections SET payload=$3::jsonb,refreshed_at=clock_timestamp() WHERE scope=$1 AND resource_id=$2`,
    [scope, resourceId, canonical(current)],
  );
}
