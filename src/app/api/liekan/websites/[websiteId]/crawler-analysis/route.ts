import { crawlerApi, crawlerBody } from '@/lib/liekan/crawler-control/http';
import {
  crawlerAnalysis,
  crawlerRange,
  crawlerCriticalPathsSchema,
  saveCrawlerCriticalPaths,
} from '@/lib/liekan/crawlers/analysis';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return crawlerApi(request, async actor => {
    const { websiteId } = await params;
    return crawlerAnalysis(actor, websiteId, crawlerRange(new URL(request.url).searchParams));
  });
}
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return crawlerApi(request, async actor => {
    const { websiteId } = await params;
    return saveCrawlerCriticalPaths(
      actor,
      websiteId,
      (await crawlerBody(request, crawlerCriticalPathsSchema)).paths,
    );
  });
}
