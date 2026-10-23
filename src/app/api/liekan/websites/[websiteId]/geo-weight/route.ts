import { geoLegacyApi } from '@/lib/liekan/upstream/geo-weight-snapshot-http';
import { readGeoWeight } from '@/lib/liekan/upstream/geo-weight';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return geoLegacyApi(request, async actor => {
    const { websiteId } = await params;
    const search = new URL(request.url).searchParams;
    search.delete('refresh');
    return readGeoWeight(actor, websiteId, Object.fromEntries(search), { signal: request.signal });
  });
}
