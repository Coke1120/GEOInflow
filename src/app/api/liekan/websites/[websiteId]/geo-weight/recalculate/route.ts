import { readBody } from '@/lib/liekan/http';
import { geoSnapshotApi } from '@/lib/liekan/upstream/geo-weight-snapshot-http';
import { recalculateGeoWeight } from '@/lib/liekan/upstream/geo-weight-snapshots';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return geoSnapshotApi(
    request,
    async actor =>
      recalculateGeoWeight(actor, (await params).websiteId, await readBody(request, 8192)),
    true,
  );
}
