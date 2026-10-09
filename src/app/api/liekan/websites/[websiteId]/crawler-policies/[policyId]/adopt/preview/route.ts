import { crawlerApi, crawlerBody } from '@/lib/liekan/crawler-control/http';
import {
  previewCrawlerAdoption,
  crawlerAdoptPreviewInput,
} from '@/lib/liekan/crawler-control/deployments';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string; policyId: string }> },
) {
  return crawlerApi(request, async actor => {
    const p = await params;
    await crawlerBody(request, crawlerAdoptPreviewInput);
    return previewCrawlerAdoption(actor, p.websiteId, p.policyId);
  });
}
