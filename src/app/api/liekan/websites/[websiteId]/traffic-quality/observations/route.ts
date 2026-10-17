import { crawlerApi } from '@/lib/liekan/crawler-control/http';
import { queryEvidence } from '@/lib/liekan/crawlers/evidence-read';
import { parseObservationQuery, readObservations } from '@/lib/liekan/crawlers/observation-read';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return crawlerApi(request, async actor =>
    queryEvidence(
      actor,
      (await params).websiteId,
      parseObservationQuery(Object.fromEntries(new URL(request.url).searchParams)),
      'observations',
      readObservations,
      false,
      request.signal,
    ),
  );
}
