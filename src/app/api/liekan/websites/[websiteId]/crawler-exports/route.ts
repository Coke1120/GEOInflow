import { crawlerApi, crawlerBody } from '@/lib/liekan/crawler-control/http';
import { crawlerExport, crawlerExportInputSchema } from '@/lib/liekan/crawler-control/exports';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return crawlerApi(request, async actor => {
    const { websiteId } = await params;
    return crawlerExport(
      actor,
      websiteId,
      await crawlerBody(request, crawlerExportInputSchema, 1048576),
    );
  });
}
