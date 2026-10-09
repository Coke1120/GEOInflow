import { crawlerApi, crawlerBody } from '@/lib/liekan/crawler-control/http';
import { crawlerPreviewInputSchema } from '@/lib/liekan/contracts/crawlers';
import { previewCrawlerPolicy } from '@/lib/liekan/crawler-control/deployments';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string; policyId: string }> },
) {
  return crawlerApi(request, async actor => {
    const p = await params;
    return previewCrawlerPolicy(
      actor,
      p.websiteId,
      p.policyId,
      await crawlerBody(request, crawlerPreviewInputSchema),
    );
  });
}
