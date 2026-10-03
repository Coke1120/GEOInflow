import { api } from '@/lib/liekan/http';
import { linkSources } from '@/lib/liekan/upstream/link-sources';
export async function GET(request: Request, { params }: { params: Promise<{ linkId: string }> }) {
  return api(async () =>
    linkSources(
      request,
      (await params).linkId,
      Object.fromEntries(new URL(request.url).searchParams),
    ),
  );
}
