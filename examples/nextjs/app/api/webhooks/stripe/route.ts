import { nextWebhook } from '../../../../../../src/adapters/next.js';
import { getLocalRuntime } from '../../../../../local/runtime.js';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return nextWebhook((await getLocalRuntime()).receiver)(request);
}
