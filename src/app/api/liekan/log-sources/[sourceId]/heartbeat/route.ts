import { api, readBody } from '@/lib/liekan/http';
import { LiekanError } from '@/lib/liekan/upstream/errors';
import { heartbeat } from '@/lib/liekan/log-ingestion/service';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ sourceId: string }> },
) {
  return api(async () => {
    const token = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (!token) throw new LiekanError('需要来源凭据', 401);
    return heartbeat((await params).sourceId, token, await readBody(request, 2048));
  });
}
