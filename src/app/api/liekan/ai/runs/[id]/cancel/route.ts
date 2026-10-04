import { aiApi } from '@/lib/liekan/ai/http';
import { cancelAiRun } from '@/lib/liekan/ai/runs';
export const runtime = 'nodejs';
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return aiApi(request, async actor => cancelAiRun(actor, (await params).id));
}
