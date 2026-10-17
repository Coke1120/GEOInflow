import { LiekanError } from '@/lib/liekan/upstream/errors';
import { z } from 'zod';
import { crawlerApi, crawlerBody } from '@/lib/liekan/crawler-control/http';
import { contextVoidSchema } from '@/lib/liekan/contracts/crawler-workflow';
import { voidCrawlerContext } from '@/lib/liekan/crawlers/workflow';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string; id: string }> },
) {
  return crawlerApi(request, async actor => {
    const p = await params;
    if (!z.uuid().safeParse(p.id).success) throw new LiekanError('上下文记录标识无效', 400);
    return voidCrawlerContext(
      actor,
      p.websiteId,
      p.id,
      await crawlerBody(request, contextVoidSchema),
    );
  });
}
