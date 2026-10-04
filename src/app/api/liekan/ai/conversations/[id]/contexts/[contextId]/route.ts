import { aiApi } from '@/lib/liekan/ai/http';
import { getAiContext } from '@/lib/liekan/ai/conversations';
export const runtime = 'nodejs';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; contextId: string }> },
) {
  return aiApi(request, async actor => {
    const p = await params;
    return getAiContext(actor, p.id, p.contextId);
  });
}
