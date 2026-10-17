import { LiekanError } from '@/lib/liekan/upstream/errors';
import { crawlerApi, crawlerBody } from '@/lib/liekan/crawler-control/http';
import { contextWriteSchema, contextQuerySchema } from '@/lib/liekan/contracts/crawler-workflow';
import { addCrawlerContext } from '@/lib/liekan/crawlers/workflow';
import { readCrawlerContext } from '@/lib/liekan/crawlers/context-read';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return crawlerApi(request, async actor => {
    const parsed = contextQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) throw new LiekanError('上下文时间范围无效', 400);
    return readCrawlerContext(actor, (await params).websiteId, parsed.data);
  });
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return crawlerApi(request, async actor =>
    addCrawlerContext(
      actor,
      (await params).websiteId,
      await crawlerBody(request, contextWriteSchema),
    ),
  );
}
