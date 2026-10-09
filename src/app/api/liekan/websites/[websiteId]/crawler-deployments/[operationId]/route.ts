import { crawlerApi } from '@/lib/liekan/crawler-control/http';
import { getCrawlerDeployment } from '@/lib/liekan/crawler-control/deployments';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string; operationId: string }> },
) {
  return crawlerApi(request, async actor => {
    const p = await params;
    return getCrawlerDeployment(actor, p.websiteId, p.operationId);
  });
}
