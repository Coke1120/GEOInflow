import { randomBytes, randomUUID } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import { z } from 'zod';
import { crawlerPathSchema } from '../contracts/crawlers';
import { parseRobots, checkRobotsAccess } from '../crawlers/robots';
import { crawlerDirectory } from '../crawlers/directory';
import { hostname } from '../log-ingestion/protocol';
import { tokenHash } from '../log-ingestion/secrets';
import {
  authorizeCrawler,
  crawlerTransaction,
  type CrawlerActor,
} from '../upstream/crawler-access';
import { LiekanError } from '../upstream/errors';
import { acquireCrawlerLease, releaseCrawlerLease } from './leases';
import { publicCrawlerProbe } from './public-probe';

export const crawlerCheckInput = z.strictObject({
  paths: z.array(crawlerPathSchema.shape.value).max(20),
});
export const crawlerDomainInput = z.strictObject({ action: z.enum(['create', 'verify']) });
const txtName = (host: string) => `_liekan-verify.${host}`;
interface CheckJob {
  id: string;
  website_id: string;
  actor_id: string;
  epoch: number;
  hostname: string;
  paths: string[];
}

export async function crawlerDomain(actor: CrawlerActor, websiteId: string) {
  return crawlerTransaction(async tx => {
    const website = await authorizeCrawler(tx, actor, websiteId);
    const host = hostname(website.domain);
    const [row] = await tx.query(
      'SELECT expires_at,verified_at FROM liekan_crawler_domain_verification WHERE website_id=$1::uuid AND hostname=$2',
      websiteId,
      host,
    );
    return {
      hostname: host,
      name: txtName(host),
      expiresAt: row?.expires_at ?? null,
      verifiedAt: row?.verified_at ?? null,
    };
  });
}
export async function changeCrawlerDomain(
  actor: CrawlerActor,
  websiteId: string,
  action: 'create' | 'verify',
) {
  const prepared = await crawlerTransaction(async tx => {
    const website = await authorizeCrawler(tx, actor, websiteId, 'draft');
    const host = hostname(website.domain);
    if (action === 'verify') return { host, value: null };
    const value = `liekan=${websiteId}:${randomBytes(24).toString('base64url')}`;
    await tx.execute(
      `INSERT INTO liekan_crawler_domain_verification(website_id,hostname,challenge_hash,expires_at,created_by)
      VALUES($1::uuid,$2,$3,now()+interval '24 hours',$4::uuid)
      ON CONFLICT(website_id,hostname) DO UPDATE SET challenge_hash=EXCLUDED.challenge_hash,expires_at=EXCLUDED.expires_at,verified_at=NULL,created_by=EXCLUDED.created_by,created_at=now()`,
      websiteId,
      host,
      tokenHash(value),
      actor.id,
    );
    return { host, value };
  });
  if (prepared.value) return { ...(await crawlerDomain(actor, websiteId)), value: prepared.value };
  const challengeHash = await verifyCrawlerDomain(websiteId, prepared.host);
  await crawlerTransaction(async tx => {
    const website = await authorizeCrawler(tx, actor, websiteId, 'draft');
    if (hostname(website.domain) !== prepared.host) throw new LiekanError('网站域名已变化', 409);
    const updated = await tx.execute(
      'UPDATE liekan_crawler_domain_verification SET verified_at=now() WHERE website_id=$1::uuid AND hostname=$2 AND challenge_hash=$3 AND (verified_at IS NOT NULL OR expires_at>now())',
      websiteId,
      prepared.host,
      challengeHash,
    );
    if (!updated) throw new LiekanError('域名挑战已变化，请重新验证', 409);
  });
  return crawlerDomain(actor, websiteId);
}
export async function verifyCrawlerDomain(websiteId: string, host: string) {
  const [row] = await crawlerTransaction(tx =>
    tx.query(
      'SELECT challenge_hash,expires_at,verified_at FROM liekan_crawler_domain_verification WHERE website_id=$1::uuid AND hostname=$2',
      websiteId,
      host,
    ),
  );
  if (!row || (!row.verified_at && +new Date(row.expires_at) < Date.now()))
    throw new LiekanError('请先验证当前网站域名', 409);
  const records = await new Resolver({ timeout: 2000, tries: 1 })
    .resolveTxt(txtName(host))
    .catch(() => []);
  if (!records.some(parts => tokenHash(parts.join('')) === row.challenge_hash))
    throw new LiekanError('域名 TXT 验证尚未通过', 409);
  return row.challenge_hash as string;
}
export async function queueCrawlerCheck(
  actor: CrawlerActor,
  websiteId: string,
  input: z.infer<typeof crawlerCheckInput>,
) {
  return crawlerTransaction(async tx => {
    const website = await authorizeCrawler(tx, actor, websiteId, 'draft');
    await tx.execute(
      'INSERT INTO liekan_crawler_state(website_id) VALUES($1::uuid) ON CONFLICT DO NOTHING',
      websiteId,
    );
    await tx.query(
      'SELECT website_id FROM liekan_crawler_state WHERE website_id=$1::uuid FOR UPDATE',
      websiteId,
    );
    const recent = await tx.query(
      "SELECT id FROM liekan_crawler_check WHERE website_id=$1::uuid AND (created_at>now()-interval '1 minute' OR state IN ('queued','running')) LIMIT 1",
      websiteId,
    );
    if (recent.length)
      throw new LiekanError('每个网站每分钟最多进行一次检查，请等待当前检查完成', 429);
    const [epoch] = await tx.query(
      'SELECT epoch FROM liekan_log_state WHERE website_id=$1::uuid',
      websiteId,
    );
    const host = hostname(website.domain);
    const [verified] = await tx.query(
      'SELECT verified_at FROM liekan_crawler_domain_verification WHERE website_id=$1::uuid AND hostname=$2 AND verified_at IS NOT NULL',
      websiteId,
      host,
    );
    if (!verified) throw new LiekanError('请先验证当前网站域名', 409);
    const id = randomUUID();
    await tx.execute(
      'INSERT INTO liekan_crawler_check(id,website_id,actor_id,epoch,hostname,paths) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::jsonb)',
      id,
      websiteId,
      actor.id,
      epoch?.epoch ?? 1,
      host,
      JSON.stringify([...new Set(input.paths)]),
    );
    return { id, state: 'queued' };
  });
}
export async function listCrawlerChecks(actor: CrawlerActor, websiteId: string) {
  return crawlerTransaction(async tx => {
    await authorizeCrawler(tx, actor, websiteId);
    return tx.query(
      'SELECT id,state,result,error_code AS "errorCode",created_at AS "createdAt",completed_at AS "completedAt" FROM liekan_crawler_check WHERE website_id=$1::uuid ORDER BY created_at DESC LIMIT 10',
      websiteId,
    );
  });
}
export async function processCrawlerCheck(workerId: string) {
  const job = await crawlerTransaction(async tx => {
    for (const slot of ['probe:0', 'probe:1']) {
      if (!(await acquireCrawlerLease(tx, slot, workerId, 300))) continue;
      const [row] = await tx.query<CheckJob>(
        `SELECT * FROM liekan_crawler_check WHERE state='queued' OR (state='running' AND lease_until<now()) ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
      );
      if (!row) {
        await releaseCrawlerLease(tx, slot, workerId);
        return null;
      }
      await tx.execute(
        "UPDATE liekan_crawler_check SET state='running',started_at=now(),lease_until=now()+interval '5 minutes' WHERE id=$1::uuid",
        row.id,
      );
      return { ...row, slot };
    }
    return null;
  });
  if (!job) return;
  try {
    await crawlerTransaction(async tx => {
      const website = await authorizeCrawler(
        tx,
        { id: job.actor_id, role: '' },
        job.website_id,
        'draft',
      );
      const [state] = await tx.query(
        'SELECT epoch FROM liekan_log_state WHERE website_id=$1::uuid',
        job.website_id,
      );
      if (hostname(website.domain) !== job.hostname || (state?.epoch ?? 1) !== job.epoch)
        throw new LiekanError('检查上下文已变化', 409);
    });
    await verifyCrawlerDomain(job.website_id, job.hostname);
    const robots = await publicCrawlerProbe(job.hostname, '/robots.txt', job.id, true);
    const document = robots.status === 200 ? parseRobots(robots.body ?? '') : null;
    const pages = [];
    const deadline = Date.now() + 120000;
    for (const path of job.paths) {
      if (Date.now() > deadline) throw new LiekanError('检查超过总时间上限，请减少页面数量', 503);
      await crawlerTransaction(async tx => {
        const website = await authorizeCrawler(
          tx,
          { id: job.actor_id, role: '' },
          job.website_id,
          'draft',
        );
        const [current] = await tx.query(
          'SELECT epoch FROM liekan_log_state WHERE website_id=$1::uuid',
          job.website_id,
        );
        const [running] = await tx.query(
          'SELECT state FROM liekan_crawler_check WHERE id=$1::uuid',
          job.id,
        );
        if (
          hostname(website.domain) !== job.hostname ||
          (current?.epoch ?? 1) !== job.epoch ||
          running?.state !== 'running'
        )
          throw new LiekanError('检查上下文已变化', 409);
      });
      await verifyCrawlerDomain(job.website_id, job.hostname);
      pages.push({
        ...(await publicCrawlerProbe(job.hostname, path, job.id)),
        robots: document
          ? crawlerDirectory
              .filter(bot => bot.robotsToken !== null)
              .map(bot => ({
                botId: bot.id,
                ...checkRobotsAccess(document, bot.robotsToken, path),
              }))
          : null,
      });
    }
    const result = { robots, pages, checkedAt: new Date().toISOString(), identity: 'self_check' };
    await crawlerTransaction(async tx => {
      const [state] = await tx.query(
        'SELECT epoch FROM liekan_log_state WHERE website_id=$1::uuid',
        job.website_id,
      );
      if ((state?.epoch ?? 1) === job.epoch)
        await tx.execute(
          "UPDATE liekan_crawler_check SET state='completed',result=$2::jsonb,completed_at=now(),lease_until=NULL WHERE id=$1::uuid AND state='running'",
          job.id,
          JSON.stringify(result),
        );
    });
  } catch (error) {
    await crawlerTransaction(tx =>
      tx.execute(
        "UPDATE liekan_crawler_check SET state='failed',error_code=$2,completed_at=now(),lease_until=NULL WHERE id=$1::uuid AND state='running'",
        job.id,
        error instanceof LiekanError && error.status === 409
          ? 'domain-or-context-changed'
          : 'public-check-unavailable',
      ),
    );
  } finally {
    await crawlerTransaction(tx => releaseCrawlerLease(tx, job.slot, workerId));
  }
}
