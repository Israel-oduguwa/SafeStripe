import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('payment form handles slow loading, recovery, failure and guarded confirmation', () => {
  // Isolate DOM globals and the official SDK doubles from the server/storage tests.
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-test-module-mocks',
      '--import',
      'tsx',
      '--test',
      'tests/fixtures/react-payment.mjs',
    ],
    { cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 30000 },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
