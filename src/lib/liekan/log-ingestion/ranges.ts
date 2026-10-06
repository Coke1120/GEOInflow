import { createHash } from 'node:crypto';
import ipaddr from 'ipaddr.js';
import bundled from '../../../../config/liekan/bot-ranges.json';
import { query, transaction } from '../upstream/server';
import type { VerificationSnapshots } from '../rules/verify';

// Refresh only the official endpoints already reviewed and bundled with this release.
export async function refreshRanges() {
  for (const [bot, snapshot] of Object.entries(bundled)) {
    try {
      const response = await fetch(snapshot.source, {
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok || !response.body) throw new Error();
      let bytes = 0;
      const chunks: Uint8Array[] = [];
      for await (const chunk of response.body as any) {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) throw new Error();
        chunks.push(chunk);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!Array.isArray(data.prefixes) || !data.prefixes.length || data.prefixes.length > 5000)
        throw new Error();
      const prefixes = data.prefixes.map((row: any) => row.ipv4Prefix || row.ipv6Prefix);
      for (const prefix of prefixes)
        if (typeof prefix !== 'string' || !ipaddr.parseCIDR(prefix)) throw new Error();
      const version = createHash('sha256').update(JSON.stringify(prefixes)).digest('hex');
      await transaction(tx =>
        tx.$executeRawUnsafe(
          `INSERT INTO liekan_bot_snapshot(bot,source_url,prefixes,retrieved_at,version) VALUES($1,$2,$3::jsonb,now(),$4)
        ON CONFLICT(bot) DO UPDATE SET prefixes=EXCLUDED.prefixes,retrieved_at=EXCLUDED.retrieved_at,version=EXCLUDED.version,error_code=NULL`,
          bot,
          snapshot.source,
          JSON.stringify(prefixes),
          version,
        ),
      );
    } catch {
      await transaction(tx =>
        tx.$executeRawUnsafe(
          "UPDATE liekan_bot_snapshot SET error_code='refresh-failed' WHERE bot=$1",
          bot,
        ),
      );
    }
  }
}
export async function verificationSnapshots(): Promise<VerificationSnapshots> {
  const snapshots: VerificationSnapshots = { ...bundled };
  for (const row of await query(
    'SELECT bot,prefixes,retrieved_at,version FROM liekan_bot_snapshot',
  ))
    snapshots[row.bot] = {
      prefixes: row.prefixes,
      retrievedAt: new Date(row.retrieved_at).toISOString(),
      version: row.version,
    };
  return snapshots;
}
