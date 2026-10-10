import { createHash, createHmac } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { v5 } from 'uuid';

export const DEFAULT_DEMO_ID = 'b880cb21-e65a-4fdf-9c0e-3da5aed4e0fa';
export const DEFAULT_DEMO_NAME = '猎看官网（示例数据）';
export const DEFAULT_DEMO_DOMAIN = 'www.liekan.com';
const directory = new URL('./liekan-demo-data/', import.meta.url);
const kinds = ['session', 'event', 'log', 'catalog', 'report'];

export class DemoSeedError extends Error {}

export async function readDemoManifest() {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));
  if (
    manifest.formatVersion !== 1 ||
    manifest.websiteId !== DEFAULT_DEMO_ID ||
    manifest.name !== DEFAULT_DEMO_NAME ||
    manifest.domain !== DEFAULT_DEMO_DOMAIN ||
    manifest.isDemo !== true ||
    manifest.file !== 'official.ndjson.gz' ||
    !/^[a-f0-9]{64}$/.test(manifest.sha256) ||
    kinds.some(kind => !Number.isSafeInteger(manifest.counts?.[kind]) || manifest.counts[kind] < 1)
  )
    throw new DemoSeedError('默认示例清单无效');
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(new URL(manifest.file, directory)))
    digest.update(bytes);
  if (digest.digest('hex') !== manifest.sha256) throw new DemoSeedError('默认示例数据校验失败');
  return manifest;
}

export async function* readDemoRecords() {
  const input = createReadStream(new URL('official.ndjson.gz', directory));
  const decoded = createGunzip();
  input.on('error', error => decoded.destroy(error));
  input.pipe(decoded);
  const lines = createInterface({ input: decoded, crlfDelay: Infinity });
  try {
    for await (const line of lines) yield JSON.parse(line);
  } finally {
    lines.close();
    input.destroy();
    decoded.destroy();
  }
}

export function demoRecord(kind, record, index, anchor, secret) {
  const uid = name => v5(name, DEFAULT_DEMO_ID);
  const at = offset => (offset === null ? null : new Date(anchor + offset).toISOString());
  if (kind === 'session') {
    const [, reference, browser, os, device, screen, language, country, region, city, offset] =
      record;
    return {
      id: uid(`session:${reference}`),
      browser,
      os,
      device,
      screen,
      language,
      country,
      region,
      city,
      time: at(offset),
    };
  }
  if (kind === 'event') {
    const [
      ,
      session,
      visit,
      offset,
      path,
      referrer,
      type,
      name,
      source,
      medium,
      campaign,
      term,
      content,
      cls,
      fcp,
      inp,
      lcp,
      ttfb,
    ] = record;
    return {
      id: uid(`event:${index}`),
      session: uid(`session:${session}`),
      visit: visit === null ? null : uid(`visit:${visit}`),
      time: at(offset),
      path,
      referrer,
      type,
      name,
      source,
      medium,
      campaign,
      term,
      content,
      cls,
      fcp,
      inp,
      lcp,
      ttfb,
    };
  }
  if (kind === 'log') {
    const [, offset, path, method, status, bytes, bot, vendor, type, version, crawler] = record;
    return {
      id: createHash('sha256').update(`liekan-demo:${index}`).digest('hex'),
      time: at(offset),
      path,
      method,
      status,
      bytes,
      bot,
      vendor,
      type,
      version,
      crawler,
      agent: `Mozilla/5.0 ${bot}/1.0 (Liekan example)`,
      ipHash: createHmac('sha256', secret)
        .update(`liekan-demo:${index % 200}`)
        .digest('hex'),
    };
  }
  if (kind === 'catalog') {
    const [, path, title, type, words, published, structured, score, updated, depth] = record;
    return {
      path,
      title,
      type,
      words,
      published: at(published),
      structured,
      score,
      updated: at(updated),
      depth,
    };
  }
  if (kind === 'report') {
    const [, type, name, description, parameters] = record;
    return { id: uid(`report:${index}`), type, name, description, parameters };
  }
  throw new DemoSeedError('默认示例记录类型无效');
}

const statements = {
  session: `INSERT INTO session(session_id,website_id,browser,os,device,screen,language,country,region,city,created_at)
    SELECT r.id,$1::uuid,r.browser,r.os,r.device,r.screen,r.language,r.country,r.region,r.city,r.time
    FROM jsonb_to_recordset($2::jsonb) AS r(id uuid,browser text,os text,device text,screen text,language text,country text,region text,city text,time timestamptz)`,
  event: `INSERT INTO website_event(event_id,website_id,session_id,visit_id,created_at,url_path,hostname,referrer_domain,event_type,event_name,utm_source,utm_medium,utm_campaign,utm_term,utm_content,cls,fcp,inp,lcp,ttfb)
    SELECT r.id,$1::uuid,r.session,r.visit,r.time,r.path,'www.liekan.com',r.referrer,r.type,r.name,r.source,r.medium,r.campaign,r.term,r.content,r.cls,r.fcp,r.inp,r.lcp,r.ttfb
    FROM jsonb_to_recordset($2::jsonb) AS r(id uuid,session uuid,visit uuid,time timestamptz,path text,referrer text,type integer,name text,source text,medium text,campaign text,term text,content text,cls numeric,fcp numeric,inp numeric,lcp numeric,ttfb numeric)`,
  log: `WITH inserted AS (
    INSERT INTO liekan_log(id,website_id,import_id,created_at,path,method,status,bytes,ip_masked,ip_hash,user_agent,location,bot,vendor,bot_type,verification)
    SELECT r.id,$1::uuid,$2::uuid,r.time,r.path,r.method,r.status,r.bytes,'203.0.113.*',r."ipHash",r.agent,'示例位置',r.bot,r.vendor,r.type,'unverified'
    FROM jsonb_to_recordset($3::jsonb) AS r(id text,time timestamptz,path text,method text,status integer,bytes bigint,"ipHash" text,agent text,bot text,vendor text,type text)
    RETURNING id
    ) INSERT INTO liekan_crawler_evidence(website_id,log_id,classification_version,crawler_id)
    SELECT $1::uuid,r.id,r.version,r.crawler FROM jsonb_to_recordset($3::jsonb) AS r(id text,version text,crawler text)
    JOIN inserted ON inserted.id=r.id`,
  catalog: `INSERT INTO liekan_catalog(website_id,path,title,content_type,word_count,published_at,structured,structure_score,content_updated_at,link_depth,evidence_source)
    SELECT $1::uuid,r.path,r.title,r.type,r.words,r.published,r.structured,r.score,r.updated,r.depth,'随代码分发的示例内容目录'
    FROM jsonb_to_recordset($2::jsonb) AS r(path text,title text,type text,words integer,published timestamptz,structured boolean,score integer,updated timestamptz,depth integer)`,
  report: `INSERT INTO report(report_id,user_id,website_id,type,name,description,parameters,created_at,updated_at)
    SELECT r.id,$2::uuid,$1::uuid,r.type,r.name,r.description,r.parameters,now(),now()
    FROM jsonb_to_recordset($3::jsonb) AS r(id uuid,type text,name text,description text,parameters jsonb)`,
};

export async function seedOfficialDemo(client, { secret, now = Date.now(), schema = 'public' }) {
  if (!secret) throw new DemoSeedError('缺少 APP_SECRET');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) throw new DemoSeedError('数据库 schema 无效');
  const manifest = await readDemoManifest();
  const anchor = now - 300000;
  const counts = Object.fromEntries(kinds.map(kind => [kind, 0]));
  const imported = v5(`import:${manifest.sha256}`, DEFAULT_DEMO_ID);
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['liekan-default-demo']);
    const existing = (
      await client.query(
        'SELECT w.name,w.domain,w.deleted_at,s.is_demo FROM website w LEFT JOIN liekan_setting s USING(website_id) WHERE w.website_id=$1::uuid FOR UPDATE OF w',
        [DEFAULT_DEMO_ID],
      )
    ).rows[0];
    if (
      existing &&
      (existing.is_demo !== true ||
        existing.name !== DEFAULT_DEMO_NAME ||
        existing.domain !== DEFAULT_DEMO_DOMAIN)
    )
      throw new DemoSeedError('默认示例 ID 已被其他网站使用，现有数据保持完整');
    if (existing?.deleted_at) {
      await client.query('COMMIT');
      return { websiteId: DEFAULT_DEMO_ID, status: 'deleted', inserted: false };
    }
    if (!existing) {
      const previous = (
        await client.query(
          "SELECT EXISTS(SELECT 1 FROM liekan_analytics_revision WHERE resource_type='website' AND resource_id=$1::uuid) AS previously_created",
          [DEFAULT_DEMO_ID],
        )
      ).rows[0].previously_created;
      if (previous) {
        await client.query('COMMIT');
        return { websiteId: DEFAULT_DEMO_ID, status: 'deleted', inserted: false };
      }
    }
    if (existing) {
      const occupied = (
        await client.query(
          `SELECT EXISTS(SELECT 1 FROM session WHERE website_id=$1::uuid)
          OR EXISTS(SELECT 1 FROM website_event WHERE website_id=$1::uuid)
          OR EXISTS(SELECT 1 FROM liekan_log WHERE website_id=$1::uuid)
          OR EXISTS(SELECT 1 FROM liekan_catalog WHERE website_id=$1::uuid)
          OR EXISTS(SELECT 1 FROM report WHERE website_id=$1::uuid) AS occupied`,
          [DEFAULT_DEMO_ID],
        )
      ).rows[0].occupied;
      if (occupied) {
        await client.query('COMMIT');
        return { websiteId: DEFAULT_DEMO_ID, status: 'existing', inserted: false };
      }
    }
    const admin = (
      await client.query(
        'SELECT user_id AS id FROM "user" WHERE role=\'admin\' AND deleted_at IS NULL ORDER BY created_at,user_id LIMIT 1',
      )
    ).rows[0];
    if (!admin) throw new DemoSeedError('初始化示例需要已有管理员，请先完成数据库迁移');
    if (!existing)
      await client.query(
        'INSERT INTO website(website_id,name,domain,user_id,created_by,created_at,updated_at) VALUES($1::uuid,$2,$3,$4::uuid,$4::uuid,now(),now())',
        [DEFAULT_DEMO_ID, DEFAULT_DEMO_NAME, DEFAULT_DEMO_DOMAIN, admin.id],
      );
    await client.query(
      'INSERT INTO liekan_setting(website_id,is_demo,rules) VALUES($1::uuid,true,$2::jsonb) ON CONFLICT(website_id) DO UPDATE SET is_demo=true,rules=EXCLUDED.rules',
      [DEFAULT_DEMO_ID, JSON.stringify(manifest.rules)],
    );
    await client.query(
      'INSERT INTO liekan_import(id,website_id,digest,accepted,rejected) VALUES($1::uuid,$2::uuid,$3,$4,0)',
      [imported, DEFAULT_DEMO_ID, manifest.sha256, manifest.counts.log],
    );
    let current;
    let batch = [];
    let sawMetadata = false;
    const flush = async () => {
      if (!batch.length) return;
      const payload = JSON.stringify(batch);
      const params =
        current === 'log'
          ? [DEFAULT_DEMO_ID, imported, payload]
          : current === 'report'
            ? [DEFAULT_DEMO_ID, admin.id, payload]
            : [DEFAULT_DEMO_ID, payload];
      await client.query(statements[current], params);
      batch = [];
    };
    for await (const record of readDemoRecords()) {
      const kind = record[0];
      if (kind === 'metadata') {
        if (sawMetadata || record[1].websiteId !== DEFAULT_DEMO_ID || record[1].isDemo !== true)
          throw new DemoSeedError('默认示例数据头无效');
        sawMetadata = true;
        continue;
      }
      if (!sawMetadata || !kinds.includes(kind)) throw new DemoSeedError('默认示例记录类型无效');
      if (current !== kind) {
        await flush();
        current = kind;
      }
      batch.push(demoRecord(kind, record, counts[kind], anchor, secret));
      counts[kind] += 1;
      if (batch.length >= 2000) await flush();
    }
    await flush();
    if (!sawMetadata || kinds.some(kind => counts[kind] !== manifest.counts[kind]))
      throw new DemoSeedError('默认示例记录数量与清单不一致');
    await client.query(
      'INSERT INTO liekan_log_state(website_id,data_revision) VALUES($1::uuid,1) ON CONFLICT(website_id) DO UPDATE SET data_revision=liekan_log_state.data_revision+1,updated_at=now()',
      [DEFAULT_DEMO_ID],
    );
    await client.query(
      "INSERT INTO liekan_analytics_revision(resource_type,resource_id,revision) VALUES('website',$1::uuid,1) ON CONFLICT(resource_type,resource_id) DO UPDATE SET revision=liekan_analytics_revision.revision+1,updated_at=now()",
      [DEFAULT_DEMO_ID],
    );
    await client.query('COMMIT');
    return {
      websiteId: DEFAULT_DEMO_ID,
      name: DEFAULT_DEMO_NAME,
      demo: true,
      status: 'created',
      inserted: true,
      counts,
      pageviews: manifest.pageviews,
      visits: manifest.visits,
      conversionEvents: manifest.conversionEvents,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
