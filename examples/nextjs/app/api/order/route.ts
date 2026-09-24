import { authenticateLocal, getLocalRuntime } from '../../../../local/runtime.js';
import { publicError } from '../../../../../src/index.js';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    authenticateLocal(request.headers.get('authorization'), request.headers.get('origin'));
    return Response.json(
      { state: await (await getLocalRuntime()).status() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const result = publicError(error);
    return Response.json(result.body, { status: result.status });
  }
}
