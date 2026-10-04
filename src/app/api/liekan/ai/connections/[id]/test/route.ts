import { aiApi } from '@/lib/liekan/ai/http';
import { testAiConnection } from '@/lib/liekan/ai/test-connection';
export const runtime = 'nodejs';
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return aiApi(request, async actor => testAiConnection(request, actor, (await params).id));
}
