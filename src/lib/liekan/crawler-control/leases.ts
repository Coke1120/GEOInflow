import type { AiTx } from '../upstream/ai-db';

export async function acquireCrawlerLease(tx: AiTx, name: string, owner: string, seconds: number) {
  const rows = await tx.query(
    `INSERT INTO liekan_crawler_lease(name,owner,expires_at) VALUES($1,$2::uuid,now()+$3*interval '1 second')
     ON CONFLICT(name) DO UPDATE SET owner=EXCLUDED.owner,expires_at=EXCLUDED.expires_at
     WHERE liekan_crawler_lease.expires_at<now() OR liekan_crawler_lease.owner=EXCLUDED.owner RETURNING name`,
    name,
    owner,
    seconds,
  );
  return rows.length === 1;
}
export async function releaseCrawlerLease(tx: AiTx, name: string, owner: string) {
  await tx.execute(
    'DELETE FROM liekan_crawler_lease WHERE name=$1 AND owner=$2::uuid',
    name,
    owner,
  );
}
