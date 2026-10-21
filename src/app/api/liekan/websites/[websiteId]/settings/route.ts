import { requestApi, api, readBody } from '@/lib/liekan/http';
import { getSettings, saveSettings } from '@/lib/liekan/store';
import { authorize } from '@/lib/liekan/upstream/server';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return requestApi(request, async () => {
    const { websiteId } = await params;
    const { website } = await authorize(request, websiteId);
    return getSettings(website.id);
  });
}
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return requestApi(request, async () => {
    const { websiteId } = await params;
    const { website, writeIdentity } = await authorize(request, websiteId, true);
    return saveSettings(website.id, await readBody(request), writeIdentity);
  });
}
