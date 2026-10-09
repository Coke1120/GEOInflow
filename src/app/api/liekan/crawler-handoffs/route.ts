import { crawlerApi } from '@/lib/liekan/crawler-control/http';
import { listCrawlerHandoffs } from '@/lib/liekan/crawler-control/service';
export async function GET(request: Request) {
  return crawlerApi(request, actor => listCrawlerHandoffs(actor));
}
