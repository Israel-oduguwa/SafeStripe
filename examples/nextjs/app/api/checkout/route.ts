import { authenticateDemo, createDemoCheckout } from '../../../../shared/runtime.js';
import { boundedBody } from '../../../../../src/adapters/next.js';
import { publicError } from '../../../../../src/index.js';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    authenticateDemo(request.headers.get('authorization'), request.headers.get('origin'));
    const raw = await boundedBody(request, 8192);
    if (raw.length && raw.toString().trim() !== '{}')
      return Response.json({ error: 'THIS_DEMO_ACCEPTS_NO_ORDER_OVERRIDES' }, { status: 400 });
    return Response.json(await createDemoCheckout(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const result = publicError(error);
    return Response.json(result.body, {
      status: result.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
