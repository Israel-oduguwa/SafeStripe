import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { runBoundedCli, stripeCliBinary } from '../scripts/stripe-lifecycle-cli.js';

test('lifecycle replay resolves the installed official platform binary', () => {
  const binary = stripeCliBinary();
  assert.ok(existsSync(binary));
  assert.match(binary, /@stripe[/\\]cli-[^/\\]+[/\\]bin[/\\]stripe(?:\.exe)?$/);
});

test('an unattended child receives EOF and cannot wait for an interactive answer', async () => {
  await runBoundedCli(
    process.execPath,
    ['-e', 'process.stdin.resume();process.stdin.on("end",()=>process.exit(0))'],
    { NODE_ENV: 'test' },
    2000,
  );
});

test('a stalled child is terminated within the bounded timeout', async () => {
  const started = Date.now();
  await assert.rejects(
    runBoundedCli(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { NODE_ENV: 'test' }, 100),
    /failed or timed out/,
  );
  assert.ok(Date.now() - started < 5000);
});

test('CLI failure output and environment values are excluded from the error', async () => {
  await assert.rejects(
    runBoundedCli(
      process.execPath,
      ['-e', 'console.error(process.env.PRIVATE_TEST_VALUE);process.exit(1)'],
      { NODE_ENV: 'test', PRIVATE_TEST_VALUE: 'synthetic-private-value' },
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'Stripe CLI replay failed or timed out');
      assert.equal(JSON.stringify(error).includes('synthetic-private-value'), false);
      return true;
    },
  );
});
