import { aiApi } from '@/lib/liekan/ai/http';
import { getAiConversation, deleteAiConversation } from '@/lib/liekan/ai/conversations';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  return aiApi(request, async actor => getAiConversation(actor, (await params).id));
}
export async function DELETE(request: Request, { params }: Context) {
  return aiApi(request, async actor => deleteAiConversation(actor, (await params).id));
}
