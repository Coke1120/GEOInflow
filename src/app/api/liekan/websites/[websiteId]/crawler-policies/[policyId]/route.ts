import { crawlerApi, crawlerBody } from '@/lib/liekan/crawler-control/http';
import { crawlerPolicyUpdateSchema } from '@/lib/liekan/contracts/crawlers';
import { getCrawlerPolicy, updateCrawlerPolicy } from '@/lib/liekan/crawler-control/service';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string; policyId: string }> },
) {
  return crawlerApi(request, async actor => {
    const p = await params;
    return getCrawlerPolicy(actor, p.websiteId, p.policyId);
  });
}
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ websiteId: string; policyId: string }> },
) {
  return crawlerApi(request, async actor => {
    const p = await params;
    return updateCrawlerPolicy(
      actor,
      p.websiteId,
      p.policyId,
      await crawlerBody(request, crawlerPolicyUpdateSchema),
    );
  });
}
