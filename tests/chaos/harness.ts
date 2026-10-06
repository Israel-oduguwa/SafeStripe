import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Pool } from 'pg';
import { DocumentJobs } from '../../src/storage/store.js';
import { sqliteStorage } from '../../src/storage/sqlite.js';
import { postgresStorage } from '../../src/storage/postgres.js';

export type Backend = 'sqlite' | 'postgres';
export async function fixture(backend: Backend) {
  const directory = await mkdtemp(join(tmpdir(), 'safestripe-chaos-'));
  const filename = join(directory, 'billing.sqlite');
  const schema = 'chaos_' + randomUUID().replaceAll('-', '');
  const scope = 'chaos-' + randomUUID();
  const admin =
    backend === 'postgres'
      ? new Pool({ connectionString: process.env.CHAOS_DATABASE_URL, max: 1 })
      : undefined;
  if (admin) await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = admin
    ? new Pool({
        connectionString: process.env.CHAOS_DATABASE_URL,
        options: `-c search_path=${schema}`,
        max: 4,
      })
    : undefined;
  const storage = pool
    ? await postgresStorage({ db: pool, migrate: true })
    : await sqliteStorage({ filename });
  const children = new Set<ReturnType<typeof child>>();
  const config = { backend, filename, schema, scope };
  return {
    storage,
    jobs: new DocumentJobs(storage.driver, { leaseSeconds: 1, maxAttempts: 10 }),
    scope,
    pool,
    config,
    spawn(mode: string) {
      const worker = child(config, mode);
      children.add(worker);
      return worker;
    },
    async drain(expectedJobs: number, concurrency = 1) {
      const workers = Array.from({ length: concurrency }, () => this.spawn('drain'));
      await Promise.all(workers.map((worker) => worker.next('running')));
      await waitUntil(async () => (await this.counts()).done === expectedJobs, 20000);
      for (const worker of workers) worker.process.send({ type: 'finish' });
      return Promise.all(
        workers.map(async (worker) => {
          await worker.next('done');
          return worker.closed;
        }),
      );
    },
    async counts() {
      const rows = pool
        ? (await pool.query('SELECT record FROM sf_records WHERE scope=$1', [scope])).rows.map(
            (r) => r.record,
          )
        : (() => {
            const db = new DatabaseSync(filename);
            try {
              return db
                .prepare('SELECT record FROM sf_records WHERE scope=?')
                .all(scope)
                .map((r) => JSON.parse(String(r.record)));
            } finally {
              db.close();
            }
          })();
      return {
        effects: rows.filter((r) => r.kind === 'effect').length,
        outbox: rows.filter((r) => r.queue === 'outbox').length,
        done: rows.filter((r) => r.queue === 'webhook' && r.value.state === 'done').length,
      };
    },
    async close() {
      // Tear down children before dropping their schema, even when an assertion fails
      // while a child is paused inside a transaction.
      await Promise.all([...children].map((worker) => worker.stop()));
      await storage.close();
      await pool?.end();
      if (admin) {
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
        await admin.end();
      }
      await rm(directory, { recursive: true, force: true });
    },
  };
}
export function child(config: object, mode: string) {
  const processChild = fork(new URL('./worker.ts', import.meta.url), [], {
    execArgv: ['--import', 'tsx'],
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    env: {
      NODE_ENV: 'test',
      PATH: process.env.PATH,
      ...(process.env.CHAOS_DATABASE_URL
        ? { CHAOS_DATABASE_URL: process.env.CHAOS_DATABASE_URL }
        : {}),
    },
  });
  const messages: Array<{ type: string; [key: string]: unknown }> = [];
  const listeners = new Set<() => void>();
  let ended = false;
  const closed = once(processChild, 'close').then(([code, signal]) => {
    ended = true;
    for (const f of listeners) f();
    return { code, signal };
  });
  processChild.on('message', (m) => {
    messages.push(m as (typeof messages)[number]);
    for (const f of listeners) f();
  });
  // Child errors are deliberately redacted; connection strings never enter test output.
  processChild.stderr?.on('data', () => {});
  processChild.send({ ...config, mode });
  return {
    process: processChild,
    closed,
    next(type: string, timeout = 20000): Promise<(typeof messages)[number]> {
      return new Promise((resolve, reject) => {
        const finish = () => {
          clearTimeout(timer);
          listeners.delete(check);
        };
        const check = () => {
          const i = messages.findIndex((m) => m.type === type);
          if (i >= 0) {
            const [m] = messages.splice(i, 1);
            finish();
            resolve(m!);
          } else if (messages.some((m) => m.type === 'failed')) {
            const failure = messages.find((m) => m.type === 'failed')!;
            finish();
            reject(new Error(`Child failed before ${type}: ${failure.code}`));
          } else if (ended) {
            finish();
            reject(new Error(`Child exited before ${type}`));
          }
        };
        const timer = setTimeout(() => {
          finish();
          reject(new Error(`Timed out awaiting ${type}`));
        }, timeout);
        listeners.add(check);
        check();
      });
    },
    async stop() {
      if (!ended) processChild.kill('SIGKILL');
      await closed;
    },
  };
}
export async function waitUntil(check: () => Promise<boolean>, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error('Recovery deadline exceeded');
    await new Promise((r) => setTimeout(r, 25));
  }
}
