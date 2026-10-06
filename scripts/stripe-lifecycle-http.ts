export const DEMO_ORIGIN = 'https://safestripe-demo.vercel.app';
export const WEBHOOK_ORIGIN = 'https://safestripe-sandbox.onrender.com';

export function checkoutUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'checkout.stripe.com' ||
    url.username ||
    url.password
  )
    throw new Error('Checkout must use the Stripe-hosted test page');
  return url.href;
}

export async function eventually<T>(
  read: () => Promise<T>,
  accepts: (value: T) => boolean,
  timeoutMs = 180_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  do {
    const value = await read();
    if (accepts(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 2500));
  } while (Date.now() < deadline);
  throw new Error('Lifecycle checkpoint timed out');
}

export class DemoSession {
  private cookie = '';
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    if (!/^\/api\/[A-Za-z0-9/_-]+$/.test(path)) throw new Error('Invalid demo API path');
    const response = await this.fetcher(DEMO_ORIGIN + path, {
      method,
      headers: {
        Origin: DEMO_ORIGIN,
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) throw new Error(`Demo request failed (${response.status})`);
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    if (cookie) {
      if (!/^[A-Za-z0-9_-]+=[A-Za-z0-9_.-]*$/.test(cookie))
        throw new Error('Invalid workspace cookie');
      this.cookie = cookie;
    }
    return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  }
}
