import { nextWebhook } from '../../../../../../src/adapters/next.js';
import { getRuntime } from '../../../../../shared/runtime.js';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return nextWebhook(getRuntime().receiver)(request);
}
