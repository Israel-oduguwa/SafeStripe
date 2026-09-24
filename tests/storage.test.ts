import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sqliteStorage } from '../src/storage/sqlite.js';
import { postgresStorage } from '../src/storage/postgres.js';
import { mongoStorage } from '../src/storage/mongodb.js';
import { firestoreStorage } from '../src/storage/firestore.js';
import { MongoClient } from 'mongodb';
import { Firestore } from '@google-cloud/firestore';
import {
  createSafeStripe,
  SafeStripe,
  WebhookReceiver,
  WebhookWorker,
  digest,
  idempotencyKey,
  scopeKey,
  type Operation,
} from '../src/index.js';
import type { BillingStorage } from '../src/storage/store.js';
import { testDatabase, scope, actor, stripe, signed, event, secret } from './helpers.js';

const providers = [
  {
    name: 'sqlite',
    enabled: true,
    open: async () => {
      const dir = await mkdtemp(join(tmpdir(), 'safestripe-sqlite-'));
      const storage = await sqliteStorage({ filename: join(dir, 'billing.sqlite') });
      return {
        storage,
        close: async () => {
          await storage.close();
          await rm(dir, { recursive: true, force: true });
        },
      };
    },
  },
  {
    name: 'postgres',
    enabled: true,
    open: async () => {
      const h = await testDatabase();
      const storage = await postgresStorage({ db: h.db, migrate: true });
      await h.db.query('TRUNCATE sf_records');
      return { storage, close: h.close };
    },
  },
  {
    name: 'mongodb',
    enabled: !!process.env.MONGODB_TEST_URI,
    open: async () => {
      const client = new MongoClient(process.env.MONGODB_TEST_URI!);
      await client.connect();
      const database = 'safestripe_test_' + randomUUID().replaceAll('-', '');
      return {
        storage: await mongoStorage({ client, database }),
        close: async () => {
          await client.db(database).dropDatabase();
          await client.close();
        },
      };
    },
  },
  {
    name: 'firestore',
    enabled: !!process.env.FIRESTORE_EMULATOR_HOST,
    open: async () => {
      const db = new Firestore({ projectId: 'safestripe-test' });
      const collection = 'test_' + randomUUID();
      return {
        storage: await firestoreStorage({ db, collection }),
        close: async () => {
          await db.recursiveDelete(db.collection(collection));
          await db.terminate();
        },
      };
    },
  },
];
for (const provider of providers)
  test(
    `${provider.name}: operation, queue, transaction and signature conformance`,
    { skip: !provider.enabled },
    async (t) => {
      const { storage, close } = await provider.open();
      t.after(close);
      const s = scopeKey(scope);
      const op: Operation = {
        scope: s,
        tenantId: actor.tenantId,
        operationId: 'order-1',
        kind: 'checkout.create',
        key: idempotencyKey(s, actor, 'checkout.create'),
        fingerprint: digest({ amount: 100 }),
      };
      await t.test('simultaneous claims grant one owner; fingerprint conflicts fail', async () => {
        const claims = await Promise.allSettled(
          Array.from({ length: 4 }, () => storage.operations.claim(op)),
        );
        assert.equal(claims.filter((x) => x.status === 'fulfilled').length, 1);
        const claim = claims.find((x) => x.status === 'fulfilled')!;
        assert.equal(claim.status, 'fulfilled');
        if (claim.status !== 'fulfilled' || claim.value.replay)
          throw new Error('Expected owned operation');
        await assert.rejects(storage.operations.claim({ ...op, fingerprint: 'changed' }), {
          code: 'PAYLOAD_CONFLICT',
        });
        await storage.operations.succeed(op, claim.value.token, 'cs_example');
        assert.deepEqual(await storage.operations.claim(op), {
          replay: true,
          resourceId: 'cs_example',
        });
        await assert.rejects(storage.operations.succeed(op, 'stale', 'cs_other'), {
          code: 'LEASE_LOST',
        });
      });
      await t.test(
        'expired operations require review and expired jobs reject stale commits',
        async () => {
          const reviewOp = { ...op, operationId: 'review-case', key: 'review-key' };
          const claim = await storage.operations.claim(reviewOp);
          assert.equal(claim.replay, false);
          await storage.driver.transaction(async (tx) => {
            const key = digest(['operation', s, reviewOp.tenantId, reviewOp.operationId]);
            const row = (await tx.get(key))!;
            row.value.createdAt = tx.now - 86_400_000;
            row.value.leaseUntil = 0;
            await tx.put(row);
          });
          await assert.rejects(storage.operations.claim(reviewOp), { code: 'REVIEW_REQUIRED' });
          assert.equal((await storage.operations.inspect(reviewOp))?.state, 'review');
          await storage.operations.resolveForReview(
            reviewOp,
            'cs_verified',
            'operator',
            'Verified the existing Stripe Session',
          );
          assert.deepEqual(await storage.operations.claim(reviewOp), {
            replay: true,
            resourceId: 'cs_verified',
          });
          await storage.jobs.enqueue('webhook', s, 'evt_expired', 'expired', event('evt_expired'));
          const job = (await storage.jobs.claim('webhook', s))!;
          await storage.driver.transaction(async (tx) => {
            const row = (await tx.get(digest(['job', 'webhook', s, job.id])))!;
            row.dueAt = 0;
            await tx.put(row);
          });
          await assert.rejects(
            storage.jobs.complete(job, async () => {}),
            { code: 'LEASE_LOST' },
          );
          const recovered = (await storage.jobs.claim('webhook', s))!;
          assert.notEqual(recovered.token, job.token);
          await storage.jobs.fail(job, true);
          assert.equal((await storage.jobs.inspect('webhook', s, job.id))?.state, 'running');
          await storage.jobs.complete(recovered, async () => {});
        },
      );
      await t.test('transaction rolls back data, effects and outbox together', async () => {
        await assert.rejects(
          storage.transaction(s, async (tx) => {
            await tx.set('orders', 'o1', { paid: true });
            await tx.effectOnce('fulfill:o1', async (inner) => {
              await inner.enqueue('receipt:o1', 'receipt', { id: 'o1' });
            });
            throw new Error('rollback');
          }),
          /rollback/,
        );
        assert.equal(await storage.read(s, 'orders', 'o1'), undefined);
        assert.equal(await storage.jobs.inspect('outbox', s, 'receipt:o1'), undefined);
        assert.equal(
          await storage.transaction(s, async (tx) =>
            tx.effectOnce('fulfill:o1', async (inner) => {
              await inner.set('orders', 'o1', { paid: true });
              await inner.enqueue('receipt:o1', 'receipt', { id: 'o1' });
            }),
          ),
          true,
        );
        assert.equal(
          await storage.transaction(s, async (tx) =>
            tx.effectOnce('fulfill:o1', async () => {
              throw new Error('duplicate');
            }),
          ),
          false,
        );
        await assert.rejects(
          storage.jobs.enqueue('outbox', s, 'receipt:o1', 'receipt', { id: 'other' }),
          { code: 'PAYLOAD_CONFLICT' },
        );
      });
      await t.test(
        'signature verification, duplicate delivery and single worker ownership',
        async () => {
          const receiver = new WebhookReceiver({
            stripe,
            scope,
            jobs: storage.jobs,
            signingSecrets: [secret],
            eventTypes: ['checkout.session.completed'],
          });
          const fixture = signed(event('evt_portable'));
          await assert.rejects(receiver.receive(fixture.raw, 'invalid'), {
            code: 'INVALID_WEBHOOK',
          });
          assert.equal((await receiver.receive(fixture.raw, fixture.signature)).duplicate, false);
          assert.equal((await receiver.receive(fixture.raw, fixture.signature)).duplicate, true);
          const jobs = await Promise.all(
            Array.from({ length: 4 }, () => storage.jobs.claim('webhook', s)),
          );
          assert.equal(jobs.filter(Boolean).length, 1);
          const job = jobs.find(Boolean)!;
          await assert.rejects(
            storage.jobs.complete({ ...job, token: 'wrong' }, async () => {}),
            { code: 'LEASE_LOST' },
          );
          await storage.jobs.complete(job, async (tx) => {
            await tx.set('orders', 'paid', { verified: true });
          });
          assert.equal((await storage.jobs.inspect('webhook', s, job.id))?.state, 'done');
          assert.deepEqual(await storage.read(s, 'orders', 'paid'), { verified: true });
        },
      );
      await t.test('concurrent read-modify-write has no lost increments', async () => {
        await storage.transaction(s, (tx) => tx.set('counter', 'one', { count: 0 }));
        await Promise.all(
          Array.from({ length: 4 }, () =>
            storage.transaction(s, async (tx) => {
              const current = await tx.get<{ count: number }>('counter', 'one');
              await tx.set('counter', 'one', { count: current!.count + 1 });
            }),
          ),
        );
        assert.deepEqual(await storage.read(s, 'counter', 'one'), { count: 4 });
      });
      await t.test('unknown handlers become dead and an audited replay can run', async () => {
        await storage.jobs.enqueue('webhook', s, 'evt_missing', 'missing', event('evt_missing'));
        const worker = new WebhookWorker(storage.jobs, s, {});
        assert.equal(await worker.runOnce(), 'failed');
        assert.equal((await storage.jobs.inspect('webhook', s, 'evt_missing'))?.state, 'dead');
        await storage.jobs.replayDead(
          'webhook',
          s,
          'evt_missing',
          'operator',
          'Added the missing handler',
        );
        const fixed = new WebhookWorker(storage.jobs, s, {
          missing: async (_event, tx) => {
            await tx.set('processed', 'missing', { done: true });
          },
        });
        assert.equal(await fixed.runOnce(), 'done');
      });
      await t.test('tenant scope isolation and payload bounds', async () => {
        assert.equal(await storage.read('different', 'orders', 'paid'), undefined);
        await assert.rejects(
          storage.transaction(s, (tx) => tx.set('x', 'y', { huge: 'x'.repeat(512_000) })),
          { code: 'BODY_TOO_LARGE' },
        );
        await assert.rejects(
          storage.transaction(s, (tx) => tx.set('x', 'y', { bad: undefined })),
          { code: 'INVALID_INPUT' },
        );
      });
    },
  );

test('SQLite file survives reopen; setup rejects live SQLite and permits an explicit sandbox account', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'safestripe-reopen-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const filename = join(dir, 'billing.sqlite');
  let storage = await sqliteStorage({ filename });
  await storage.transaction('scope', (tx) => tx.set('orders', 'one', { saved: true }));
  await storage.close();
  storage = await sqliteStorage({ filename });
  t.after(() => storage.close());
  assert.deepEqual(await storage.read('scope', 'orders', 'one'), { saved: true });
  const billing = await createSafeStripe({
    secretKey: 'sk_test_' + 'offlineOnlyFixture',
    accountId: 'acct_offline',
    storage,
    appOrigin: 'http://localhost:3000',
    allowLocalhost: true,
    authorize: async () => false,
  });
  assert.equal(billing.scope.livemode, false);
  await assert.rejects(billing.createCustomer(actor, { email: 'example@example.com' }), {
    code: 'FORBIDDEN',
  });
  await assert.rejects(
    createSafeStripe({
      secretKey: 'sk_live_' + 'offlineOnlyFixture',
      storage,
      appOrigin: 'https://example.com',
      authorize: async () => false,
    }),
    /SQLite/,
  );
});

test('custom Checkout uses the server return URL and session-based Payment Element flow', async (t) => {
  const storage = await sqliteStorage({ filename: ':memory:' });
  t.after(() => storage.close());
  const original = stripe.checkout.sessions.create;
  t.after(() => {
    stripe.checkout.sessions.create = original;
  });
  let params: Record<string, unknown> = {};
  stripe.checkout.sessions.create = (async (input: unknown) => {
    params = input as Record<string, unknown>;
    return { id: 'cs_custom', client_secret: 'fixture' };
  }) as typeof original;
  const billing = new SafeStripe({
    stripe,
    scope,
    operations: storage.operations,
    authorize: async () => true,
    appOrigin: 'https://shop.example',
  });
  await billing.createCheckout(actor, {
    customerId: 'cus_example',
    mode: 'payment',
    uiMode: 'custom',
    items: [{ priceId: 'price_example', quantity: 1 }],
    reference: 'order-1',
  });
  assert.equal(params.ui_mode, 'custom');
  assert.equal(params.return_url, 'https://shop.example/success?session_id={CHECKOUT_SESSION_ID}');
  assert.equal(params.success_url, undefined);
  assert.equal(params.payment_method_types, undefined);
});

test('setup discovers account scope from the key when accountId is omitted', async (t) => {
  const storage = await sqliteStorage({ filename: ':memory:' });
  t.after(() => storage.close());
  const prototype = Object.getPrototypeOf(stripe.accounts) as typeof stripe.accounts;
  const lookup = t.mock.method(prototype, 'retrieve', async () => ({ id: 'acct_discovered' }));
  const billing = await createSafeStripe({
    secretKey: 'sk_test_' + 'offlineOnlyFixture',
    storage,
    appOrigin: 'https://example.com',
    authorize: async () => false,
  });
  assert.equal(billing.scope.platformAccountId, 'acct_discovered');
  assert.equal(lookup.mock.callCount(), 1);
});
