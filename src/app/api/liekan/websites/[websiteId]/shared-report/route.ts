import { requestApi, api } from '@/lib/liekan/http';
import { readSharedReport } from '@/lib/liekan/upstream/shared-report';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return requestApi(request, async () => readSharedReport(request, (await params).websiteId));
}
