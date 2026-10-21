import { requestApi, api, readBody } from '@/lib/liekan/http';
import { exchangePairing } from '@/lib/liekan/log-ingestion/pairing';
export async function POST(request: Request) {
  return requestApi(request, async () => exchangePairing(await readBody(request, 1024)));
}
