import { z } from 'zod';
import { aiApi, readAiBody } from '@/lib/liekan/ai/http';
import { AiError } from '@/lib/liekan/ai/error';
import { getAiMessages } from '@/lib/liekan/ai/conversations';
import { analyzeAiConversation } from '@/lib/liekan/ai/analyze';
export const runtime = 'nodejs';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return aiApi(request, async actor => {
    const p = z
      .strictObject({
        cursor: z.string().max(256).optional(),
        limit: z.coerce.number().int().min(1).max(50).optional(),
      })
      .safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!p.success) throw new AiError('invalid_request', '历史列表参数无效');
    return getAiMessages(actor, (await params).id, p.data.cursor, p.data.limit);
  });
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return aiApi(request, async actor =>
    analyzeAiConversation(request, actor, (await params).id, await readAiBody(request)),
  );
}
