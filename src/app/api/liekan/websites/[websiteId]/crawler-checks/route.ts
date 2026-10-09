import { crawlerApi, crawlerBody } from '@/lib/liekan/crawler-control/http';
import {
  listCrawlerChecks,
  queueCrawlerCheck,
  crawlerCheckInput,
} from '@/lib/liekan/crawler-control/diagnostics';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return crawlerApi(request, async actor => {
    const { websiteId } = await params;
    return listCrawlerChecks(actor, websiteId);
  });
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return crawlerApi(request, async actor => {
    const { websiteId } = await params;
    return queueCrawlerCheck(actor, websiteId, await crawlerBody(request, crawlerCheckInput));
  });
}
