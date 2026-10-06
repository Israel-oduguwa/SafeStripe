import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sandboxCredentials } from '../scripts/stripe-e2e-config.js';

test('service test guard rejects live keys and requires opt-in for test secret keys', async () => {
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

test('secret-key opt-in accepts only a confirmed test key and retains account checks', async () => {
  const env = {
    STRIPE_E2E_CONFIRM: 'disposable-sandbox',
    STRIPE_ACCOUNT_ID: 'acct_example',
    STRIPE_SECRET_KEY: 'sk_test_example',
    STRIPE_E2E_ALLOW_SECRET_KEY: 'true',
  };
  assert.deepEqual(await sandboxCredentials(env), {
    key: 'sk_test_example',
    keyKind: 'secret',
    account: 'acct_example',
    temporary: false,
    expiry: undefined,
  });
  assert.equal(
    (await sandboxCredentials({ ...env, STRIPE_SECRET_KEY: 'rk_test_example' })).keyKind,
    'restricted',
  );
  for (const key of [
    'sk_live_example',
    'rk_live_example',
    'pk_test_example',
    'rkcs_test_example',
    'sk_test_example\n',
    'sk_test_',
  ])
    await assert.rejects(sandboxCredentials({ ...env, STRIPE_SECRET_KEY: key }));
  for (const approval of [undefined, 'false', 'TRUE', '1'])
    await assert.rejects(sandboxCredentials({ ...env, STRIPE_E2E_ALLOW_SECRET_KEY: approval }));
  await assert.rejects(sandboxCredentials({ ...env, STRIPE_E2E_CONFIRM: undefined }));
  await assert.rejects(sandboxCredentials({ ...env, STRIPE_ACCOUNT_ID: undefined }));
  await assert.rejects(sandboxCredentials({ ...env, STRIPE_ACCOUNT_ID: 'acct_example/other' }));
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
