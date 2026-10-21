import { requestApi, api, readBody } from '@/lib/liekan/http';
import { LiekanError } from '@/lib/liekan/upstream/errors';
import { heartbeat, collectorConnection } from '@/lib/liekan/log-ingestion/service';
export async function GET(request: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  return requestApi(request, async () => {
    const token = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (!token) throw new LiekanError('需要来源凭据', 401);
    return collectorConnection((await params).sourceId, token);
  });
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ sourceId: string }> },
) {
  return requestApi(request, async () => {
    const token = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (!token) throw new LiekanError('需要来源凭据', 401);
    return heartbeat((await params).sourceId, token, await readBody(request, 65536));
  });
}
