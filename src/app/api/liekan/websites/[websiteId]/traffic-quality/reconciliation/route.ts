import { crawlerApi } from '@/lib/liekan/crawler-control/http';
import {
  parseEvidenceQuery,
  queryEvidence,
  readReconciliation,
} from '@/lib/liekan/crawlers/evidence-read';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return crawlerApi(request, async actor => {
    const { websiteId } = await params;
    const query = parseEvidenceQuery(Object.fromEntries(new URL(request.url).searchParams), true);
    return queryEvidence(
      actor,
      websiteId,
      query,
      'traffic-quality/reconciliation',
      readReconciliation,
      false,
      request.signal,
    );
  });
}
