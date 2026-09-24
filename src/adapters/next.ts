import type { WebhookReceiver } from '../webhooks.js';
import { SafeStripeError, publicError } from '../errors.js';

export async function boundedBody(request: Request, limit: number): Promise<Buffer> {
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit))
    throw new SafeStripeError('BODY_TOO_LARGE', 'Payload exceeds limit', 413);
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new SafeStripeError('BODY_TOO_LARGE', 'Payload exceeds limit', 413);
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}
/** Next.js App Router: export const runtime='nodejs'; export const POST=nextWebhook(receiver). */
export function nextWebhook(receiver: WebhookReceiver): (request: Request) => Promise<Response> {
  return async (request) => {
    const headers = { 'Cache-Control': 'no-store' };
    if (request.method !== 'POST')
      return Response.json(
        { error: 'METHOD_NOT_ALLOWED' },
        { status: 405, headers: { ...headers, Allow: 'POST' } },
      );
    if (
      request.headers.get('content-encoding') &&
      request.headers.get('content-encoding') !== 'identity'
    )
      return Response.json({ error: 'UNSUPPORTED_ENCODING' }, { status: 415, headers });
    if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json')
      return Response.json({ error: 'JSON_REQUIRED' }, { status: 415, headers });
    try {
      const raw = await boundedBody(request, receiver.maxBytes);
      return Response.json(
        await receiver.receive(raw, request.headers.get('stripe-signature') ?? undefined),
        { status: 200, headers },
      );
    } catch (error) {
      const response = publicError(error);
      return Response.json(response.body, { status: response.status, headers });
    }
  };
}
