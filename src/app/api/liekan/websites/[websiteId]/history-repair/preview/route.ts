import { readBody, requestApi } from '@/lib/liekan/http';
import { authorizeHistoryRepair } from '@/lib/liekan/upstream/history-repair-api';
import { previewHistoryRepair } from '@/lib/liekan/upstream/history-repair';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return requestApi(request, async () => {
    const { websiteId, identity } = await authorizeHistoryRepair(request, (await params).websiteId);
    return previewHistoryRepair(websiteId, await readBody(request, 8192), identity);
  });
}
