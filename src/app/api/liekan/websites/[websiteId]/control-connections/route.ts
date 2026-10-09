import { crawlerApi, crawlerBody } from '@/lib/liekan/crawler-control/http';
import { crawlerConnectionInputSchema } from '@/lib/liekan/contracts/crawlers';
import {
  listCrawlerConnections,
  connectCrawlerConnection,
  resumeCrawlerControl,
  crawlerControlInput,
} from '@/lib/liekan/crawler-control/service';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return crawlerApi(request, async actor =>
    listCrawlerConnections(actor, (await params).websiteId),
  );
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return crawlerApi(request, async actor =>
    connectCrawlerConnection(
      actor,
      (await params).websiteId,
      await crawlerBody(request, crawlerConnectionInputSchema),
    ),
  );
}
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return crawlerApi(request, async actor =>
    resumeCrawlerControl(
      actor,
      (await params).websiteId,
      await crawlerBody(request, crawlerControlInput),
    ),
  );
}
