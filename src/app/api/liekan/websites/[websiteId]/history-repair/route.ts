import { requestApi } from '@/lib/liekan/http';
import { authorizeHistoryRepair } from '@/lib/liekan/upstream/history-repair-api';
import { getHistoryRepair } from '@/lib/liekan/upstream/history-repair';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return requestApi(request, async () => {
    const { websiteId, identity } = await authorizeHistoryRepair(request, (await params).websiteId);
    return getHistoryRepair(websiteId, new URL(request.url).searchParams, identity);
  });
}
