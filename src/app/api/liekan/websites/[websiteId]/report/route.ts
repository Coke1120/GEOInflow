import { api } from '@/lib/liekan/http';
import { buildReport } from '@/lib/liekan/report';
import { authorize } from '@/lib/liekan/upstream/server';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return api(async () => {
    const { websiteId } = await params;
    const access = await authorize(request, websiteId);
    return buildReport(
      access.website,
      access.canManage,
      Object.fromEntries(new URL(request.url).searchParams),
    );
  });
}
