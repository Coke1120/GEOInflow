import { crawlerApi, crawlerBody } from '@/lib/liekan/crawler-control/http';
import {
  reconcileCrawlerDeployment,
  crawlerReconcileInput,
} from '@/lib/liekan/crawler-control/deployments';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string; operationId: string }> },
) {
  return crawlerApi(request, async actor => {
    const p = await params;
    return reconcileCrawlerDeployment(
      actor,
      p.websiteId,
      p.operationId,
      await crawlerBody(request, crawlerReconcileInput),
    );
  });
}
