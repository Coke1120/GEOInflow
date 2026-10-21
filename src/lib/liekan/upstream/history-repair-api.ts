import { authenticateCrawlerMaintenance } from './crawler-maintenance';
import { authorize, LiekanError } from './server';
import type { WriteIdentity } from './server';

export async function authenticateHistoryRepair(request: Request): Promise<WriteIdentity> {
  if (process.env.CLICKHOUSE_URL) throw new LiekanError('历史数据修复当前支持 PostgreSQL', 501);
  const actor = await authenticateCrawlerMaintenance(request);
  return { userId: actor.id };
}

export async function authorizeHistoryRepair(request: Request, websiteId: string) {
  const identity = await authenticateHistoryRepair(request);
  const { website } = await authorize(request, websiteId, true);
  return { websiteId: website.id, identity };
}
