import { requestApi, readBody } from '@/lib/liekan/http';
import { authorize } from '@/lib/liekan/upstream/server';
import { withPublishedRegistry } from '@/lib/liekan/upstream/crawler-registry-context';
import { prepareFeatureExport } from '@/lib/liekan/upstream/feature-exports';
export async function POST(request: Request, { params }: { params: Promise<{ websiteId: string }> }) {
  try {
    return await withPublishedRegistry(async catalog => {
      const { websiteId } = await params;
      const { website } = await authorize(request, websiteId);
      const response = await prepareFeatureExport(website, await readBody(request), request.signal);
      response.headers.set('X-Liekan-Catalog-Version', catalog.version);
      return response;
    }, request.headers.get('X-Liekan-Catalog-Version') || undefined);
  } catch (error) {
    return requestApi(request, async () => { throw error; });
  }
}
