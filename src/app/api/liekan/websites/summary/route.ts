import { api } from '@/lib/liekan/http';
import { withQueryCacheHeaders } from '@/lib/liekan/upstream/cache-context';
import { readWebsiteSummary } from '@/lib/liekan/upstream/website-summary';

export async function GET(request: Request) {
  return withQueryCacheHeaders(() =>
    api(() => readWebsiteSummary(request, Object.fromEntries(new URL(request.url).searchParams))), request
  );
}
