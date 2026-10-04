import { api } from '@/lib/liekan/http';
import { receiveBatch } from '@/lib/liekan/log-ingestion/service';
export const runtime = 'nodejs';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ sourceId: string }> },
) {
  return api(async () => receiveBatch(request, (await params).sourceId));
}
