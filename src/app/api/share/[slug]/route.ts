import { ROLES, SHARE_TOKEN_TYPE } from '@/lib/constants';
import { checkAuth } from '@/lib/auth';
import { secret } from '@/lib/crypto';
import { createToken } from '@/lib/jwt';
import { readBody } from '@/lib/liekan/http';
import { LiekanError } from '@/lib/liekan/upstream/errors';
import { currentShareScope, loadShareEntity } from '@/lib/liekan/upstream/live-share';
import {
  acquireSharePasswordAttempt,
  ShareAttemptError,
} from '@/lib/liekan/upstream/share-attempts';
import {
  hasSharePassword,
  sharePasswordProof,
  verifySharePasswordAsync,
} from '@/lib/liekan/upstream/share-security';
import prisma, { getRawQueryClient } from '@/lib/prisma';
import redis from '@/lib/redis';
import { badRequest, json, notFound, payloadTooLarge, unauthorized } from '@/lib/response';
import type { WhiteLabel } from '@/lib/types';
import { getShareByCode } from '@/queries/prisma';

async function getAccountId(entity: { userId?: string; teamId?: string }): Promise<string | null> {
  if (entity.userId) {
    return entity.userId;
  }

  if (entity.teamId) {
    const teamOwner = await (
      getRawQueryClient(prisma.client, { write: true }) as typeof prisma.client
    ).teamUser.findFirst({
      where: {
        teamId: entity.teamId,
        role: ROLES.teamOwner,
      },
      select: {
        userId: true,
      },
    });

    return teamOwner?.userId || null;
  }

  return null;
}

async function getWhiteLabel(accountId: string): Promise<WhiteLabel | null> {
  if (!redis.enabled) {
    return null;
  }

  const data = await redis.client.get(`white-label:${accountId}`);

  if (data) {
    return data as WhiteLabel;
  }

  return null;
}

async function resolveShare(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
  password?: string,
) {
  const { slug } = await params;

  const share = await getShareByCode(slug);

  if (!share || (share.parameters as any)?.enabled === false) {
    return notFound();
  }
  if (hasSharePassword(share.parameters)) {
    if (password === undefined) {
      const auth = await checkAuth(request);
      if (!auth || !('shareToken' in auth) || !auth.shareToken || auth.shareToken.shareId !== share.id)
        return json({ requiresPassword: true, name: share.name });
    } else {
    const release = await acquireSharePasswordAttempt(request, share.id);
    try {
      if (!(await verifySharePasswordAsync(password, share.parameters)))
        return unauthorized({ message: '分享密码不正确' });
    } finally {
      release();
    }
    }
  }

  const scope = await currentShareScope(share);
  if (!scope) return notFound();
  const data: Record<string, any> = { ...scope, name: share.name };
  const entity = await loadShareEntity(share.shareType, share.entityId);

  data.token = createToken(
    { ...data, passwordProof: sharePasswordProof(share.parameters), type: SHARE_TOKEN_TYPE },
    secret(),
  );

  const accountId = await getAccountId(entity);

  if (accountId) {
    const whiteLabel = await getWhiteLabel(accountId);
    if (whiteLabel) {
      data.whiteLabel = whiteLabel;
    }
  }

  return json(data);
}
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  return resolveShare(request, context);
}
export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  let body: any;
  try {
    body = await readBody(request, 1024);
  } catch (error) {
    if (error instanceof LiekanError && error.status === 413)
      return payloadTooLarge({ message: '分享密码请求上限 1 KiB' });
    return badRequest({ message: '请求格式无效' });
  }
  if (typeof body?.password !== 'string' || Buffer.byteLength(body.password) > 72)
    return badRequest({ message: '分享密码格式无效' });
  try {
    return await resolveShare(request, context, body.password);
  } catch (error) {
    if (error instanceof ShareAttemptError)
      return Response.json(
        {
          error: {
            code: error.status === 429 ? 'share-password-throttled' : 'share-password-unavailable',
            message: error.message,
            status: error.status,
          },
        },
        {
          status: error.status,
          headers: {
            'Retry-After': String(error.retryAfter),
            'Cache-Control': 'private, no-store',
          },
        },
      );
    throw error;
  }
}
