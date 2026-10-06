import { z } from 'zod';
import { aiApi, readAiBody } from '@/lib/liekan/ai/http';
import { AiError } from '@/lib/liekan/ai/error';
import { listAiConnections, createAiConnection } from '@/lib/liekan/ai/connections';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  return aiApi(request, async actor => {
    const p = z
      .strictObject({ spaceKind: z.enum(['personal', 'team']), spaceId: z.uuid() })
      .safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!p.success) throw new AiError('invalid_request', '请选择明确的个人或团队空间');
    return listAiConnections(actor, { kind: p.data.spaceKind, id: p.data.spaceId.toLowerCase() });
  });
}
export async function POST(request: Request) {
  return aiApi(request, async actor => createAiConnection(actor, await readAiBody(request)));
}
