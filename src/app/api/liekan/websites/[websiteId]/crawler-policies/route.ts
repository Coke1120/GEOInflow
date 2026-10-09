import { crawlerApi, crawlerBody } from '@/lib/liekan/crawler-control/http';
import { crawlerPolicyCreateSchema } from '@/lib/liekan/contracts/crawlers';
import { listCrawlerPolicies, createCrawlerPolicy } from '@/lib/liekan/crawler-control/service';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return crawlerApi(request, async actor => listCrawlerPolicies(actor, (await params).websiteId));
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return crawlerApi(request, async actor =>
    createCrawlerPolicy(
      actor,
      (await params).websiteId,
      await crawlerBody(request, crawlerPolicyCreateSchema),
    ),
  );
}
