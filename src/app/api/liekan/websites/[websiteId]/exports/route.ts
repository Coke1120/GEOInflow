import { api, readBody } from '@/lib/liekan/http';
import { authorize } from '@/lib/liekan/upstream/server';
import { prepareFeatureExport } from '@/lib/liekan/upstream/feature-exports';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  try {
    const { websiteId } = await params;
    const { website } = await authorize(request, websiteId);
    return await prepareFeatureExport(website, await readBody(request), request.signal);
  } catch (error) {
    return api(async () => {
      throw error;
    });
  }
}
