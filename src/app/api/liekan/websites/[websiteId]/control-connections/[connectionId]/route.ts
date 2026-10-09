import { crawlerApi, crawlerBody } from '@/lib/liekan/crawler-control/http';
import {
  disconnectCrawlerConnection,
  crawlerDisconnectInput,
} from '@/lib/liekan/crawler-control/service';
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ websiteId: string; connectionId: string }> },
) {
  return crawlerApi(request, async actor => {
    const p = await params;
    const input =
      request.headers.get('content-length') === '0' || !request.body
        ? { retainForConfirmedCleanup: false }
        : await crawlerBody(request, crawlerDisconnectInput);
    return disconnectCrawlerConnection(actor, p.websiteId, p.connectionId, input);
  });
}
