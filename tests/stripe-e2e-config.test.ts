import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sandboxCredentials } from '../scripts/stripe-e2e-config.js';

test('service test guard rejects live, unrestricted and unapproved keys before API access', async () => {
  for (const key of ['sk_live_example', 'rk_live_example', 'sk_test_example', 'rkcs_test_example'])
    await assert.rejects(
      sandboxCredentials({
        STRIPE_E2E_CONFIRM: 'disposable-sandbox',
        STRIPE_ACCOUNT_ID: 'acct_example',
        STRIPE_SECRET_KEY: key,
      }),
    );
  await assert.rejects(sandboxCredentials({ STRIPE_SECRET_KEY: 'rk_test_example' }));
});

test('temporary service credentials require a matching, unexpired test-only manifest', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'safestripe-sandbox-config-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = join(directory, 'sandbox.json');
  const env = {
    STRIPE_E2E_CONFIRM: 'disposable-sandbox',
    STRIPE_ACCOUNT_ID: 'acct_example',
    STRIPE_E2E_TEMPORARY_SANDBOX_FILE: filename,
  };
  const valid = {
    secret_key: 'rkcs_test_example',
    account_id: 'acct_example',
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  };
  for (const invalid of [
    { ...valid, secret_key: 'rkcs_live_example' },
    { ...valid, account_id: 'acct_other' },
    { ...valid, expires_at: 'invalid' },
    { ...valid, expires_at: new Date(Date.now() - 86400000).toISOString() },
    { ...valid, expires_at: new Date(Date.now() + 20 * 86400000).toISOString() },
  ]) {
    await writeFile(filename, JSON.stringify(invalid), { mode: 0o600 });
    await assert.rejects(sandboxCredentials(env));
  }
  await writeFile(filename, JSON.stringify(valid), { mode: 0o600 });
  assert.equal((await sandboxCredentials(env)).temporary, true);
});
