import { api, readBody } from '@/lib/liekan/http';
import { authenticateCrawler } from '@/lib/liekan/upstream/crawler-access';
import { exportEvidence } from '@/lib/liekan/crawlers/evidence-export';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  try {
    const actor = await authenticateCrawler(request);
    const { websiteId } = await params;
    return await exportEvidence(actor, websiteId, await readBody(request, 32768), request, [
      'reconciliation',
      'observations',
    ]);
  } catch (error) {
    return api(async () => {
      throw error;
    });
  }
}
