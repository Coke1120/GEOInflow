import { crawlerApi, crawlerBody } from '@/lib/liekan/crawler-control/http';
import { crawlerConfirmInputSchema } from '@/lib/liekan/contracts/crawlers';
import { confirmCrawlerPolicy } from '@/lib/liekan/crawler-control/deployments';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string; policyId: string }> },
) {
  return crawlerApi(request, async actor => {
    const p = await params;
    return confirmCrawlerPolicy(
      actor,
      p.websiteId,
      p.policyId,
      'stop',
      await crawlerBody(request, crawlerConfirmInputSchema),
    );
  });
}
