import prisma, { getRawQueryClient, getSchema } from '@/lib/prisma';
import type { Auth } from '@/lib/types';
import { ACCOUNT_DEFAULT_TIMEZONE, validateTimezone } from '../contracts/account-preferences';
import { LiekanError } from './errors';

/** Capture the publisher's saved timezone once, when a new share is submitted. */
export async function captureShareCalendar(auth: Auth, parameters: Record<string, any> = {}) {
  if (!auth?.user?.id || auth.shareToken) throw new LiekanError('需要完整登录', 401);
  const primary = getRawQueryClient(prisma.client, { write: true }) as typeof prisma.client;
  const schema = getSchema();
  const table = schema
    ? `"${schema.replaceAll('"', '""')}"."liekan_account_preferences"`
    : '"liekan_account_preferences"';
  const rows = await primary.$queryRawUnsafe<{ timezone: string }[]>(
    `SELECT timezone FROM ${table} WHERE user_id=$1::uuid`,
    auth.user.id,
  );
  const timezone = validateTimezone(rows[0]?.timezone)
    ? rows[0].timezone
    : ACCOUNT_DEFAULT_TIMEZONE;
  const hasDates = ['range', 'date', 'startAt', 'endAt'].some(key =>
    Object.hasOwn(parameters, key),
  );
  return { ...parameters, ...(!hasDates && { range: '0day' }), timezone };
}
