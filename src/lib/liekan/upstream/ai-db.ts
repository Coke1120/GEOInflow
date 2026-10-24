import prisma, { getRawQueryClient } from '@/lib/prisma';
import { databaseSchema } from './database-schema';
import { withTrafficPolicy } from './traffic-query';
export interface AiTx {
  query<T = Record<string, any>>(sql: string, ...params: unknown[]): Promise<T[]>;
  execute(sql: string, ...params: unknown[]): Promise<number>;
  /** Execute trusted SQL whose shared traffic policy has already been applied. */
  queryPrepared?<T = Record<string, any>>(sql: string, ...params: unknown[]): Promise<T[]>;
}
export function aiExecutor(raw: any): AiTx {
  return {
    queryPrepared: (sql, ...params) => raw.$queryRawUnsafe(sql, ...params),
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
  const schema = databaseSchema();
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
