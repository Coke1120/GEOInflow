import { requestApi, api } from '@/lib/liekan/http';
import {
  authenticateCrawlerMaintenance,
  crawlerCandidates,
} from '@/lib/liekan/upstream/crawler-maintenance';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return requestApi(request, async () =>
    crawlerCandidates(await authenticateCrawlerMaintenance(request), (await params).websiteId),
  );
}
