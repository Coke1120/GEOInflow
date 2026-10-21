import { requestApi, api } from '@/lib/liekan/http';
import { acceptCloudflareCallback } from '@/lib/liekan/log-ingestion/cloudflare';
export async function GET(request: Request) {
  let location: string;
  const result = await requestApi(request, async () => {
    location = await acceptCloudflareCallback(request);
    return { ok: true };
  });
  return location
    ? new Response(null, {
        status: 303,
        headers: { location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
      })
    : result;
}
