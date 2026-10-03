import { ROLES, SHARE_TOKEN_TYPE } from '@/lib/constants';
import { secret } from '@/lib/crypto';
import { createToken } from '@/lib/jwt';
import prisma, { getRawQueryClient } from '@/lib/prisma';
import redis from '@/lib/redis';
import { json, notFound, unauthorized, badRequest } from '@/lib/response';
import { readBody } from '@/lib/liekan/http';
import {
  hasSharePassword,
  publicShareParameters,
  sharePasswordProof,
  verifySharePassword,
} from '@/lib/liekan/upstream/share-security';
import type { WhiteLabel } from '@/lib/types';
import { getShareByCode } from '@/queries/prisma';
import { currentShareScope, loadShareEntity } from '@/lib/liekan/upstream/live-share';

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
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
  password?: string,
) {
  const { slug } = await params;

  const share = await getShareByCode(slug);

  if (!share || (share.parameters as any)?.enabled === false) {
    return notFound();
  }
  if (hasSharePassword(share.parameters)) {
    if (password === undefined) return json({ requiresPassword: true, name: share.name });
    if (!verifySharePassword(password, share.parameters))
      return unauthorized({ message: '分享密码不正确' });
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
  try {
    const body = await readBody(request);
    if (typeof body.password !== 'string' || Buffer.byteLength(body.password) > 72)
      return badRequest({ message: '分享密码格式无效' });
    return resolveShare(request, context, body.password);
  } catch {
    return badRequest({ message: '请求格式无效' });
  }
}
