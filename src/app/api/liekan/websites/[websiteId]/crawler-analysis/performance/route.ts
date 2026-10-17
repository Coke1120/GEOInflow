import { crawlerApi } from '@/lib/liekan/crawler-control/http';
import { queryEvidence } from '@/lib/liekan/crawlers/evidence-read';
import { parsePerformanceQuery, readPerformance } from '@/lib/liekan/crawlers/performance-read';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return crawlerApi(request, async actor =>
    queryEvidence(
      actor,
      (await params).websiteId,
      parsePerformanceQuery(Object.fromEntries(new URL(request.url).searchParams)),
      'performance',
      readPerformance,
      false,
      request.signal,
    ),
  );
}
