import {
  PostgresJobs,
  WebhookReceiver,
  WebhookWorker,
  effectOnce,
  scopeKey,
} from '../src/index.js';
import { event, scope, secret, signed, stripe, testDatabase } from '../tests/helpers.js';
// Offline demonstration: embedded PostgreSQL, generated SDK signatures, no Stripe API requests.
if (process.env.TEST_DATABASE_URL)
  throw new Error('The offline demo requires an isolated embedded database');
const harness = await testDatabase();
try {
  const jobs = new PostgresJobs(harness.db);
  const scopeId = scopeKey(scope);
  const receiver = new WebhookReceiver({
    stripe,
    jobs,
    scope,
    signingSecrets: [secret],
    eventTypes: ['checkout.session.completed'],
  });
  const worker = new WebhookWorker(jobs, scopeId, {
    'checkout.session.completed': async (_event, tx) => {
      await effectOnce(tx, scopeId, 'tenant-a:order-1:fulfill', async () => {
        await jobs.enqueue(
          'outbox',
          scopeId,
          'order-1:receipt',
          'receipt',
          { orderId: 'order-1' },
          tx,
        );
      });
    },
  });
  for (const id of ['evt_1', 'evt_1', 'evt_2']) {
    const value = signed(event(id));
    console.log(id, await receiver.receive(value.raw, value.signature));
  }
  while ((await worker.runOnce()) !== 'idle') {
    /* Drain admitted events. */
  }
  console.log(
    'Two distinct events and one duplicate delivery → one business effect and one receipt intent.',
  );
  console.table(
    (await harness.db.query('SELECT queue,id,state FROM sf_jobs ORDER BY queue,id')).rows,
  );
  console.table((await harness.db.query('SELECT effect_key FROM sf_effects')).rows);
} finally {
  await harness.close();
}
