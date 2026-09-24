import { authenticateLocal, getLocalRuntime } from '../../../../local/runtime.js';
import { boundedBody } from '../../../../../src/adapters/next.js';
import { publicError } from '../../../../../src/index.js';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    authenticateLocal(request.headers.get('authorization'), request.headers.get('origin'));
    const raw = await boundedBody(request, 8192);
    const input = raw.length ? JSON.parse(raw.toString()) : {};
    if (
      !input ||
      Array.isArray(input) ||
      typeof input !== 'object' ||
      Object.keys(input).some((key) => key !== 'uiMode') ||
      !['hosted', 'custom'].includes(input.uiMode ?? 'hosted')
    )
      return Response.json({ error: 'INVALID_INPUT' }, { status: 400 });
    return Response.json(await (await getLocalRuntime()).createCheckout(input.uiMode ?? 'hosted'), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof SyntaxError)
      return Response.json({ error: 'INVALID_JSON' }, { status: 400 });
    const result = publicError(error);
    return Response.json(result.body, {
      status: result.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
