import prisma, { getRawQueryClient } from '@/lib/prisma';
import { AiError } from '../ai/error';
import { withTrafficPolicy } from './traffic-query';
export interface AiTx {
  query<T = Record<string, any>>(sql: string, ...params: unknown[]): Promise<T[]>;
  execute(sql: string, ...params: unknown[]): Promise<number>;
}
export function aiExecutor(raw: any): AiTx {
  return {
    query: (sql, ...params) =>
      raw.$queryRawUnsafe('/* liekan_ai */ ' + withTrafficPolicy(sql), ...params),
    execute: (sql, ...params) => raw.$executeRawUnsafe('/* liekan_ai */ ' + sql, ...params),
  };
}
export async function aiTransaction<T>(
  work: (tx: AiTx) => Promise<T>,
  options: {
    readOnly?: boolean;
    timeout?: number;
    repeatableRead?: boolean;
    maxWait?: number;
    transactionTimeout?: number;
  } = {},
) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new AiError('database_unavailable', '数据库尚未配置', 503);
  const schema = new URL(url).searchParams.get('schema') || 'public';
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema))
    throw new AiError('database_unavailable', '数据库设置无效', 503);
  const timeout = options.timeout ?? 5000;
  const primary: any = getRawQueryClient(prisma.client, { write: true });
  return primary.$transaction(
    async (raw: any) => {
      await raw.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      await raw.$executeRawUnsafe(`SET LOCAL statement_timeout TO '${timeout}ms'`);
      if (options.readOnly) await raw.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return work(aiExecutor(raw));
    },
    {
      timeout: options.transactionTimeout ?? timeout + 1000,
      maxWait: options.maxWait ?? 1000,
      ...(options.repeatableRead ? { isolationLevel: 'RepeatableRead' } : {}),
    },
  ) as Promise<T>;
}
