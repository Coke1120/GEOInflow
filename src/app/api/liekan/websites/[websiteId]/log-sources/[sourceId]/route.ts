import { api, readBody } from '@/lib/liekan/http';
import { authorize } from '@/lib/liekan/upstream/server';
import { manageSource, disconnectSource } from '@/lib/liekan/log-ingestion/service';
type Context = { params: Promise<{ websiteId: string; sourceId: string }> };
export async function PUT(request: Request, { params }: Context) {
  return api(async () => {
    const { websiteId, sourceId } = await params;
    const { website, writeIdentity } = await authorize(request, websiteId, true);
    return manageSource(website.id, sourceId, await readBody(request, 2048), writeIdentity);
  });
}
export async function DELETE(request: Request, { params }: Context) {
  return api(async () => {
    const { websiteId, sourceId } = await params;
    const { website, writeIdentity } = await authorize(request, websiteId, true);
    return disconnectSource(website.id, sourceId, writeIdentity);
  });
}
