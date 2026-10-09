import { crawlerApi, crawlerBody } from '@/lib/liekan/crawler-control/http';
import {
  crawlerDomain,
  changeCrawlerDomain,
  crawlerDomainInput,
} from '@/lib/liekan/crawler-control/diagnostics';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return crawlerApi(request, async actor => {
    const { websiteId } = await params;
    return crawlerDomain(actor, websiteId);
  });
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return crawlerApi(request, async actor => {
    const { websiteId } = await params;
    return changeCrawlerDomain(
      actor,
      websiteId,
      (await crawlerBody(request, crawlerDomainInput)).action,
    );
  });
}
