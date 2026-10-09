import { crawlerApi, crawlerBody } from '@/lib/liekan/crawler-control/http';
import {
  crawlerHandoffReconcileInput,
  reconcileCrawlerHandoffDeployment,
} from '@/lib/liekan/crawler-control/deployments';
export async function POST(request: Request) {
  return crawlerApi(request, async actor =>
    reconcileCrawlerHandoffDeployment(
      actor,
      await crawlerBody(request, crawlerHandoffReconcileInput),
    ),
  );
}
