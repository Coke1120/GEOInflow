import { api } from '@/lib/liekan/http';
import { authorize } from '@/lib/liekan/upstream/server';
import { geographyDiagnostics } from '@/lib/liekan/upstream/geography-diagnostics';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return api(async () => {
    const { websiteId } = await params;
    const { website } = await authorize(request, websiteId);
    return geographyDiagnostics(website.id, new URL(request.url).searchParams);
  });
}
