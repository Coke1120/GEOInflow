import { api } from '@/lib/liekan/http';
import { authorize } from '@/lib/liekan/upstream/server';
import { listSources } from '@/lib/liekan/log-ingestion/service';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return api(async () => {
    const { websiteId } = await params;
    const { website } = await authorize(request, websiteId);
    return { sources: await listSources(website.id) };
  });
}
