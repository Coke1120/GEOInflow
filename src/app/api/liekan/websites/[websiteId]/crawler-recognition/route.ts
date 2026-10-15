import { api } from '@/lib/liekan/http';
import {
  authenticateCrawlerMaintenance,
  crawlerRecognition,
} from '@/lib/liekan/upstream/crawler-maintenance';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return api(async () =>
    crawlerRecognition(await authenticateCrawlerMaintenance(request), (await params).websiteId),
  );
}
