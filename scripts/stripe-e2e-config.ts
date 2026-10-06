import { readFile } from 'node:fs/promises';

export async function sandboxCredentials(env: Record<string, string | undefined>) {
  if (env.STRIPE_E2E_CONFIRM !== 'disposable-sandbox')
    throw new Error('Set STRIPE_E2E_CONFIRM=disposable-sandbox to permit test-object creation');
  const account = env.STRIPE_ACCOUNT_ID ?? '';
  if (!/^acct_[A-Za-z0-9]+$/.test(account)) throw new Error('Set the expected sandbox account ID');
  if (env.STRIPE_E2E_TEMPORARY_SANDBOX_FILE) {
    const text = await readFile(env.STRIPE_E2E_TEMPORARY_SANDBOX_FILE, 'utf8');
    if (text.length > 10000) throw new Error('Invalid temporary sandbox manifest');
    const value = JSON.parse(text) as Record<string, unknown>;
    const expiry = typeof value.expires_at === 'string' ? Date.parse(value.expires_at) : NaN;
    if (
      typeof value.secret_key !== 'string' ||
      !/^rkcs_test_[A-Za-z0-9]+$/.test(value.secret_key) ||
      value.account_id !== account ||
      !Number.isFinite(expiry) ||
      expiry <= Date.now() ||
      expiry > Date.now() + 8 * 86400000
    )
      throw new Error('Invalid, expired or mismatched temporary sandbox manifest');
    return {
      key: value.secret_key,
      keyKind: 'temporary' as const,
      account,
      temporary: true,
      expiry: value.expires_at,
    };
  }
  const key = env.STRIPE_SECRET_KEY ?? '';
  const restricted = /^rk_test_[A-Za-z0-9]+$/.test(key);
  const secret = /^sk_test_[A-Za-z0-9]+$/.test(key);
  if (!restricted && !(secret && env.STRIPE_E2E_ALLOW_SECRET_KEY === 'true'))
    throw new Error(
      'Provide a restricted sandbox key, or explicitly enable a sandbox secret key with STRIPE_E2E_ALLOW_SECRET_KEY=true',
    );
  return {
    key,
    keyKind: restricted ? ('restricted' as const) : ('secret' as const),
    account,
    temporary: false,
    expiry: undefined,
  };
}
