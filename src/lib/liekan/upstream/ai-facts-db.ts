import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { AiError } from '../ai/error';

const factsClient = Symbol.for('liekan.ai.facts.prisma');
const cache = globalThis as typeof globalThis & { [key: symbol]: PrismaClient | undefined };

// Waiting for the cross-instance lane uses one private primary connection per process.
// Statistics and short authorization transactions keep their existing pool capacity.
export function getAiFactsClient(): PrismaClient {
  if (cache[factsClient]) return cache[factsClient];
  const url = process.env.DATABASE_URL;
  if (!url) throw new AiError('database_unavailable', '数据库尚未配置', 503);
  try {
    const schema = new URL(url).searchParams.get('schema') || 'public';
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error('schema');
    return (cache[factsClient] = new PrismaClient({
      adapter: new PrismaPg(
        {
          connectionString: url,
          max: 1,
          application_name: 'liekan-ai-facts',
          allowExitOnIdle: true,
        },
        { schema },
      ),
      errorFormat: 'minimal',
    }));
  } catch {
    throw new AiError('database_unavailable', '数据库设置无效', 503);
  }
}

export async function disconnectAiFactsClient() {
  const client = cache[factsClient];
  if (!client) return;
  await client.$disconnect();
  if (cache[factsClient] === client) delete cache[factsClient];
}
