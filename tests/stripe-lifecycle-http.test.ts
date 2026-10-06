import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkoutUrl, DemoSession, DEMO_ORIGIN } from '../scripts/stripe-lifecycle-http.js';

test('a lifecycle payment opens only a Stripe HTTPS Checkout URL', () => {
  assert.equal(
    checkoutUrl('https://checkout.stripe.com/c/pay/test'),
    'https://checkout.stripe.com/c/pay/test',
  );
  for (const url of [
    'http://checkout.stripe.com/test',
    'https://checkout.stripe.com.evil.invalid/test',
    'https://user:password@checkout.stripe.com/test',
    'https://evil.invalid/test',
  ])
    assert.throws(() => checkoutUrl(url));
});

test('workspace credentials cannot follow redirects or an arbitrary API origin', async () => {
  let calls = 0;
  const session = new DemoSession((async (url, options) => {
    calls++;
    assert.equal(url, DEMO_ORIGIN + '/api/workspaces');
    assert.equal(options?.redirect, 'error');
    assert.equal(new Headers(options?.headers).get('Origin'), DEMO_ORIGIN);
    return new Response('{}', { status: 302, headers: { location: 'https://evil.invalid' } });
  }) as typeof fetch);
  await assert.rejects(
    session.request('/api/workspaces', 'POST', { secretKey: 'synthetic-fixture' }),
  );
  for (const path of ['//evil.invalid/api', '/api/../evil', '/api/workspace?redirect=evil'])
    await assert.rejects(session.request(path, 'POST', {}));
  assert.equal(calls, 1);
});

test('only the returned private cookie is reused and a lost response is not retried as a new workspace', async () => {
  let calls = 0;
  const session = new DemoSession((async (_url, options) => {
    calls++;
    if (calls === 1)
      return new Response('{}', {
        headers: { 'Set-Cookie': 'workspace=opaque.token; HttpOnly; Secure' },
      });
    assert.equal(new Headers(options?.headers).get('Cookie'), 'workspace=opaque.token');
    throw new TypeError('Synthetic response loss');
  }) as typeof fetch);
  await session.request('/api/workspaces', 'POST', {});
  await assert.rejects(session.request('/api/workspace'));
  assert.equal(calls, 2);
});
