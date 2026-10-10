import { api } from '@/lib/liekan/http';
import { authorize } from '@/lib/liekan/upstream/server';
import { dockerDeployment } from '@/lib/liekan/log-ingestion/docker-deployment';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return api(async () => {
    const { websiteId } = await params;
    const { website } = await authorize(request, websiteId, true);
    return dockerDeployment(website.id);
  });
}
