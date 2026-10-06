import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drainBacklog } from '../benchmarks/drain.js';

test('benchmark drain survives a failed claim and transient idle without losing the backlog', async () => {
  let calls = 0;
  const result = await drainBacklog(
    async () => {
      if (++calls === 1) throw Object.assign(new Error('claim conflict'), { code: '40001' });
      if (calls === 2) return 'idle';
      return 'done';
    },
    2,
    { concurrency: 1, deadlineMs: 1000 },
  );
  assert.equal(result.completed, 2);
  assert.equal(result.claimFailures, 1);
  assert.equal(result.handlerFailures, 0);
  assert.equal(result.deadlineExceeded, false);
});

test('benchmark drain reports an incomplete deadline rather than a successful empty queue', async () => {
  const result = await drainBacklog(async () => 'idle', 1, { concurrency: 2, deadlineMs: 30 });
  assert.equal(result.deadlineExceeded, true);
  assert.equal(result.completed, 0);
});
