import { readReportEvidence } from '@/lib/liekan/crawlers/report-evidence';
import { crawlerApi } from '@/lib/liekan/crawler-control/http';
import {
  parseEvidenceQuery,
  queryEvidence,
  readCrawlerEvidence,
} from '@/lib/liekan/crawlers/evidence-read';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return crawlerApi(request, async actor => {
    const { websiteId } = await params;
    const query = parseEvidenceQuery(Object.fromEntries(new URL(request.url).searchParams), false);
    const reportResource = 'reportResource' in query && query.reportResource;
    return queryEvidence(
      actor,
      websiteId,
      query,
      reportResource ? 'report-evidence' : 'crawler-analysis/evidence',
      reportResource ? readReportEvidence : readCrawlerEvidence,
      false,
      request.signal,
    );
  });
}
