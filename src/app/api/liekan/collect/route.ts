import { z } from 'zod';
import { POST as send } from '@/app/api/send/route';
import { readBody } from '@/lib/liekan/http';
import { withAuthenticatedCollection } from '@/lib/liekan/upstream/collection-auth';
import { authorize, LiekanError } from '@/lib/liekan/upstream/server';

export async function POST(request: Request) {
  try {
    const body = await readBody(request, 1024 * 1024);
    const websiteId = body?.payload?.website;
    if (!z.uuid().safeParse(websiteId).success || body?.payload?.link || body?.payload?.pixel)
      throw new LiekanError('服务端采集须提供网站 UUID');
    await authorize(request, websiteId, true);
    const headers = new Headers(request.headers);
    headers.delete('content-length');
    const boundedRequest = new Request(request.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    return await withAuthenticatedCollection(boundedRequest, () => send(boundedRequest));
  } catch (error) {
    const status = error instanceof LiekanError ? error.status : 500;
    return Response.json(
      {
        error: {
          message: error instanceof LiekanError ? error.message : '采集失败',
          code: 'liekan-collection-error',
          status,
        },
      },
      { status },
    );
  }
}
