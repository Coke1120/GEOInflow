import { readBody, requestApi } from '@/lib/liekan/http';
import { authenticateCrawler } from '@/lib/liekan/upstream/crawler-access';
import { exportGeoWeight } from '@/lib/liekan/upstream/geo-weight-export';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  try {
    const actor = await authenticateCrawler(request);
    const { websiteId } = await params;
    return await exportGeoWeight(actor, websiteId, await readBody(request, 8192), request);
  } catch (error) {
    return requestApi(request, async () => {
      throw error;
    });
  }
}
