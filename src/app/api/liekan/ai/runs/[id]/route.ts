import { aiApi } from '@/lib/liekan/ai/http';
import { getAiRun } from '@/lib/liekan/ai/runs';
export const runtime = 'nodejs';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return aiApi(request, async actor => getAiRun(actor, (await params).id));
}
