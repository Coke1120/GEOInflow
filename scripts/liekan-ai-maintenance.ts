import 'dotenv/config';
import { open, constants } from 'node:fs/promises';
import { parseAiMaintenanceArgs } from '../src/lib/liekan/ai/maintenance-args';
import { createHash } from 'node:crypto';
let prisma: typeof import('../src/lib/prisma').default | undefined;
const args = process.argv.slice(2);
try {
  const options = parseAiMaintenanceArgs(args),
    { operation, apply } = options;
  if (options.help) {
    console.log(
      '用法: liekan:ai:maintenance [check|cleanup|rotate-key|restore-reset] [--apply --database 数据库名]',
    );
    console.log(
      '默认只读预览；轮换执行另需 --old-key-file 旧密钥文件 --new-key-file 新密钥文件（权限 0600）。',
    );
    process.exit(0);
  }
  prisma = (await import('../src/lib/prisma')).default;
  const { aiMaintenanceCheck, cleanupAiData, rotateAiKeys, resetRestoredAiData } = await import(
    '../src/lib/liekan/ai/maintenance'
  );
  const url = new URL(process.env.DATABASE_URL ?? '');
  const target = decodeURIComponent(url.pathname.slice(1));
  if ((apply || options.database) && options.database !== target)
    throw Error('修改数据需使用 --database 明确指定当前数据库名称。');
  const before = await aiMaintenanceCheck();
  console.log(JSON.stringify({ operation, database: target, host: url.hostname, apply, before }));
  if (!apply || operation === 'check') process.exitCode = 0;
  else if (operation === 'cleanup')
    console.log(JSON.stringify(await cleanupAiData({ apply: true })));
  else if (operation === 'restore-reset') console.log(JSON.stringify(await resetRestoredAiData()));
  else {
    const readKey = async (path?: string) => {
      if (!path) throw Error('轮换需提供权限 0600 的旧、新密钥文件。');
      const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await file.stat();
        if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.size > 128)
          throw Error('维护文件权限或大小无效。');
        const key = (await file.readFile('utf8')).trim();
        if (!/^[0-9a-fA-F]{64}$/.test(key)) throw Error('密钥格式无效。');
        return key;
      } finally {
        await file.close();
      }
    };
    const oldKey = await readKey(options.oldKeyFile),
      key = await readKey(options.newKeyFile);
    const result = await rotateAiKeys(key, oldKey);
    console.log(
      JSON.stringify({
        ...result,
        newKeyId: createHash('sha256').update(Buffer.from(key, 'hex')).digest('hex').slice(0, 16),
      }),
    );
  }
} catch {
  console.error(
    '维护未完成。请检查数据库标识、实例停用状态、租约和维护文件；已开始的事务会完整回滚。',
  );
  process.exitCode = 1;
} finally {
  await prisma?.client.$disconnect();
}
