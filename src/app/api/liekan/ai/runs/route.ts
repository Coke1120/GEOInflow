import { z } from 'zod';
import { aiApi } from '@/lib/liekan/ai/http';
import { findAiRun } from '@/lib/liekan/ai/runs';
import { AiError } from '@/lib/liekan/ai/error';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  return aiApi(request, async actor => {
    const p = z
      .strictObject({ clientRequestId: z.uuid() })
      .safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!p.success) throw new AiError('invalid_request', '请提供原请求标识');
    return findAiRun(actor, p.data.clientRequestId);
  });
}
