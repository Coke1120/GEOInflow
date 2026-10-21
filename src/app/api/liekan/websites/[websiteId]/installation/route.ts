import { requestApi, api, readBody } from '@/lib/liekan/http';
import { getInstallation, saveInstallation } from '@/lib/liekan/installation';
import { authorize } from '@/lib/liekan/upstream/server';

type Context = { params: Promise<{ websiteId: string }> };
export async function GET(request: Request, { params }: Context) {
  return requestApi(request, async () => {
    const { websiteId } = await params;
    const { website, canManage } = await authorize(request, websiteId);
    return getInstallation(website.id, canManage);
  });
}
export async function POST(request: Request, { params }: Context) {
  return requestApi(request, async () => {
    const { websiteId } = await params;
    const { website, writeIdentity } = await authorize(request, websiteId, true);
    return saveInstallation(website.id, await readBody(request, 2048), writeIdentity);
  });
}
