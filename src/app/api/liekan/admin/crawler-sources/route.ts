import { requestApi, api } from '@/lib/liekan/http';
import {
  authenticateCrawlerMaintenance,
  crawlerSources,
} from '@/lib/liekan/upstream/crawler-maintenance';
export async function GET(request: Request) {
  return requestApi(request, async () => crawlerSources(await authenticateCrawlerMaintenance(request)));
}
