import { AiError } from '../ai/error';

/** Validated PostgreSQL identifier shared by transactions and explicitly qualified raw reads. */
export function databaseSchema(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new AiError('database_unavailable', '数据库尚未配置', 503);
  const schema = new URL(url).searchParams.get('schema') || 'public';
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema))
    throw new AiError('database_unavailable', '数据库设置无效', 503);
  return schema;
}
