import 'dotenv/config';
import pg from 'pg';
import { DemoSeedError, seedOfficialDemo } from './liekan-demo.mjs';

let client;
try {
  if (!process.env.DATABASE_URL) throw new DemoSeedError('缺少 DATABASE_URL');
  if (!process.env.APP_SECRET) throw new DemoSeedError('缺少 APP_SECRET');
  const schema = new URL(process.env.DATABASE_URL).searchParams.get('schema') || 'public';
  client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const result = await seedOfficialDemo(client, { secret: process.env.APP_SECRET, schema });
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(
    error instanceof DemoSeedError
      ? error.message
      : `默认示例初始化失败（${error.code || 'runtime'}），请检查数据库连接及迁移。`,
  );
  process.exitCode = 1;
} finally {
  await client?.end();
}
