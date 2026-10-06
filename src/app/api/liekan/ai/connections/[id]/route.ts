import { z } from 'zod';
import { aiApi, readAiBody } from '@/lib/liekan/ai/http';
import { AiError } from '@/lib/liekan/ai/error';
import { updateAiConnection, deleteAiConnection } from '@/lib/liekan/ai/connections';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, { params }: Context) {
  return aiApi(request, async actor =>
    updateAiConnection(actor, (await params).id, await readAiBody(request)),
  );
}
export async function DELETE(request: Request, { params }: Context) {
  return aiApi(request, async actor => {
    const p = z
      .strictObject({ rowVersion: z.number().int().positive() })
      .safeParse(await readAiBody(request));
    if (!p.success) throw new AiError('invalid_request', '删除配置需要当前版本');
    return deleteAiConnection(actor, (await params).id, p.data.rowVersion);
  });
}
