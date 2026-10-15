import { api } from '@/lib/liekan/http';
import {
  authenticateCrawlerMaintenance,
  crawlerSources,
} from '@/lib/liekan/upstream/crawler-maintenance';
export async function GET(request: Request) {
  return api(async () => crawlerSources(await authenticateCrawlerMaintenance(request)));
}
