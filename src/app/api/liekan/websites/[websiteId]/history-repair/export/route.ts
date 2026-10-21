import { requestApi } from '@/lib/liekan/http';
import { authorizeHistoryRepair } from '@/lib/liekan/upstream/history-repair-api';
import { exportHistoryRepair } from '@/lib/liekan/upstream/history-repair';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  try {
    const { websiteId, identity } = await authorizeHistoryRepair(request, (await params).websiteId);
    const result = await exportHistoryRepair(
      websiteId,
      new URL(request.url).searchParams,
      identity,
    );
    await authorizeHistoryRepair(request, websiteId);
    const filename = result.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    return new Response(result.csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return requestApi(request, async () => {
      throw error;
    });
  }
}
