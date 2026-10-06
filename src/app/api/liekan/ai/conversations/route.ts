import { z } from 'zod';
import { aiApi, readAiBody } from '@/lib/liekan/ai/http';
import { listAiConversations, createAiConversation } from '@/lib/liekan/ai/conversations';
import { AiError } from '@/lib/liekan/ai/error';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  return aiApi(request, async actor => {
    const p = z
      .strictObject({
        websiteId: z.uuid(),
        cursor: z.string().max(500).optional(),
        limit: z.coerce.number().int().min(1).max(50).optional(),
      })
      .safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!p.success) throw new AiError('invalid_request', '对话列表参数无效');
    return listAiConversations(actor, p.data.websiteId, p.data.cursor, p.data.limit);
  });
}
export async function POST(request: Request) {
  return aiApi(request, async actor => createAiConversation(actor, await readAiBody(request)));
}
