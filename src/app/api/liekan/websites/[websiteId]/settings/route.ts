import { api, readBody } from '@/lib/liekan/http';
import { getSettings, saveSettings } from '@/lib/liekan/store';
import { authorize } from '@/lib/liekan/upstream/server';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return api(async () => {
    const { websiteId } = await params;
    await authorize(request, websiteId);
    return getSettings(websiteId);
  });
}
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return api(async () => {
    const { websiteId } = await params;
    const { website, writeIdentity } = await authorize(request, websiteId, true);
    return saveSettings(website.id, await readBody(request), writeIdentity);
  });
}
