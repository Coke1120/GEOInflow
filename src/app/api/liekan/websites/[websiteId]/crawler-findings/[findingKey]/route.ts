import { z } from 'zod';
import { crawlerApi, crawlerBody } from '@/lib/liekan/crawler-control/http';
import { changeCrawlerFinding } from '@/lib/liekan/crawlers/analysis';
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ websiteId: string; findingKey: string }> },
) {
  return crawlerApi(request, async actor => {
    const { websiteId, findingKey } = await params;
    const body = await crawlerBody(request, z.strictObject({ ignored: z.boolean() }));
    return changeCrawlerFinding(actor, websiteId, findingKey, body.ignored);
  });
}
