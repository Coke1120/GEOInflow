import { crawlerApi, crawlerBody } from '@/lib/liekan/crawler-control/http';
import { workflowWriteSchema } from '@/lib/liekan/contracts/crawler-workflow';
import { changeFindingWorkflow } from '@/lib/liekan/crawlers/workflow';
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ websiteId: string; findingKey: string }> },
) {
  return crawlerApi(request, async actor => {
    const p = await params;
    return changeFindingWorkflow(
      actor,
      p.websiteId,
      p.findingKey,
      await crawlerBody(request, workflowWriteSchema),
    );
  });
}
