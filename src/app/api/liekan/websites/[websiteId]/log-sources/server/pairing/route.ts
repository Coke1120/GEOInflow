import { requestApi, api, readBody } from '@/lib/liekan/http';
import { authorize } from '@/lib/liekan/upstream/server';
import { createPairing } from '@/lib/liekan/log-ingestion/pairing';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return requestApi(request, async () => {
    const { websiteId } = await params;
    const { website, writeIdentity } = await authorize(request, websiteId, true);
    return createPairing(
      website.id,
      writeIdentity,
      request.body ? await readBody(request, 4096) : {},
    );
  });
}
