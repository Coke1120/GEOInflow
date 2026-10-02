import { randomUUID } from 'node:crypto';
import ipaddr from 'ipaddr.js';
import { parseCatalog, parseLogInput } from './ingest';
import { BOT_RULES, BOT_TYPES, type BotRule } from './rules/bots';
import {
  LiekanError,
  lockWritableWebsite,
  query,
  transaction,
  type WriteIdentity,
} from './upstream/server';

export async function getSettings(id: string) {
  const row = (
    await query(
      'SELECT robots,allowlist,rules,is_demo AS "isDemo" FROM liekan_setting WHERE website_id=$1::uuid',
      id,
    )
  )[0];
  return {
    robots: row?.robots ?? '',
    allowlist: row?.allowlist ?? [],
    rules: row?.rules?.length ? row.rules : BOT_RULES,
    isDemo: row?.isDemo ?? false,
  };
}
export async function saveSettings(id: string, body: any, identity?: WriteIdentity) {
  id = id.toLowerCase();
  if (
    typeof body.robots !== 'string' ||
    body.robots.length > 50000 ||
    !Array.isArray(body.allowlist) ||
    !Array.isArray(body.rules) ||
    body.allowlist.length > 100 ||
    body.rules.length > 100
  )
    throw new LiekanError('设置格式无效');
  for (const ip of body.allowlist) {
    try {
      ipaddr.parseCIDR(ip);
    } catch {
      throw new LiekanError('白名单必须是合法 CIDR');
    }
  }
  for (const rule of body.rules)
    if (
      !['name', 'vendor', 'type', 'pattern'].every(
        key => typeof rule[key] === 'string' && rule[key].length > 0 && rule[key].length <= 80,
      )
    )
      throw new LiekanError('规则需要 name、vendor、type、pattern 字段，长度上限 80');
  if (body.rules.some(rule => !BOT_TYPES.includes(rule.type)))
    throw new LiekanError('规则类型仅支持训练、搜索、用户触发、传统搜索和其他');
  await transaction(async tx => {
    await lockWritableWebsite(tx, id, identity);
    await tx.$executeRawUnsafe(
      'INSERT INTO liekan_setting(website_id,robots,allowlist,rules) VALUES ($1::uuid,$2,$3::jsonb,$4::jsonb) ON CONFLICT(website_id) DO UPDATE SET robots=$2,allowlist=$3::jsonb,rules=$4::jsonb,updated_at=now()',
      id,
      body.robots,
      JSON.stringify(body.allowlist),
      JSON.stringify(body.rules),
    );
  });
  return getSettings(id);
}
export async function importLogs(id: string, domain: string, input: any, identity?: WriteIdentity) {
  id = id.toLowerCase();
  const settings = await getSettings(id);
  let parsed: ReturnType<typeof parseLogInput>;
  try {
    parsed = parseLogInput(
      input,
      domain,
      process.env.APP_SECRET ||
        (() => {
          throw new LiekanError('缺少 APP_SECRET，无法保护来源标识');
        })(),
      settings.rules as BotRule[],
    );
  } catch (error) {
    throw new LiekanError((error as Error).message);
  }
  if (!parsed.records.length)
    throw new LiekanError('没有有效日志；请检查时间、IP、路径、状态和 User-Agent');
  return transaction(async tx => {
    // One importing transaction per website, including across replicas/processes.
    const lock = await tx.$queryRawUnsafe(
      'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired',
      `liekan-import:${id}`,
    );
    if (!lock[0].acquired) throw new LiekanError('该站点已有导入正在处理', 409);
    await lockWritableWebsite(tx, id, identity);
    const old = await tx.$queryRawUnsafe(
      'SELECT id,accepted,rejected FROM liekan_import WHERE website_id=$1::uuid AND digest=$2',
      id,
      parsed.digest,
    );
    if (old.length) return { ...old[0], duplicate: true, inserted: 0, errors: parsed.errors };
    const rate = await tx.$queryRawUnsafe(
      "SELECT count(*)::int AS count FROM liekan_import WHERE website_id=$1::uuid AND imported_at>now()-interval '1 minute'",
      id,
    );
    if (rate[0].count >= 5) throw new LiekanError('每站点每分钟上限 5 次导入', 429);
    const importId = randomUUID();
    await tx.$executeRawUnsafe(
      'INSERT INTO liekan_import (id,website_id,digest,accepted,rejected) VALUES ($1::uuid,$2::uuid,$3,$4,$5)',
      importId,
      id,
      parsed.digest,
      parsed.accepted,
      parsed.rejected,
    );
    let inserted = 0;
    for (let offset = 0; offset < parsed.records.length; offset += 500) {
      inserted += await tx.$executeRawUnsafe(
        `INSERT INTO liekan_log(id,website_id,import_id,created_at,path,method,status,bytes,ip_masked,ip_hash,user_agent,location,bot,vendor,bot_type,verification)
        SELECT r.id,$1::uuid,$2::uuid,r.time::timestamptz,r.path,r.method,r.status,r.bytes,r."ipMasked",r."ipHash",r."userAgent",r.location,r.bot,r.vendor,r.type,r.verification
        FROM jsonb_to_recordset($3::jsonb) AS r(id text,time text,path text,method text,status integer,bytes bigint,"ipMasked" text,"ipHash" text,"userAgent" text,location text,bot text,vendor text,type text,verification text)
        ON CONFLICT(website_id,id) DO NOTHING`,
        id,
        importId,
        JSON.stringify(parsed.records.slice(offset, offset + 500)),
      );
    }
    return {
      id: importId,
      accepted: parsed.accepted,
      rejected: parsed.rejected,
      inserted,
      duplicate: false,
      errors: parsed.errors,
    };
  });
}
export async function importCatalog(
  id: string,
  domain: string,
  input: any,
  identity?: WriteIdentity,
) {
  id = id.toLowerCase();
  let rows: ReturnType<typeof parseCatalog>;
  try {
    rows = parseCatalog(input, domain);
  } catch (error) {
    throw new LiekanError((error as Error).message);
  }
  if (!rows.length) throw new LiekanError('内容目录为空');
  await transaction(async tx => {
    await lockWritableWebsite(tx, id, identity);
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      `liekan-catalog:${id}`,
    );
    for (let i = 0; i < rows.length; i += 500) {
      await tx.$executeRawUnsafe(
        `INSERT INTO liekan_catalog(website_id,path,title,content_type,word_count,published_at,structured,structure_score,content_updated_at,link_depth,evidence_source)
        SELECT $1::uuid,r.path,r.title,r.type,r."wordCount",r."publishedAt"::timestamptz,r.structured,r."structureScore",r."updatedAt"::timestamptz,r."linkDepth",r.source
        FROM jsonb_to_recordset($2::jsonb) AS r(path text,title text,type text,"wordCount" integer,"publishedAt" text,structured boolean,"structureScore" integer,"updatedAt" text,"linkDepth" integer,source text)
        ON CONFLICT(website_id,path) DO UPDATE SET title=EXCLUDED.title,content_type=EXCLUDED.content_type,word_count=EXCLUDED.word_count,published_at=EXCLUDED.published_at,structured=EXCLUDED.structured,structure_score=EXCLUDED.structure_score,content_updated_at=EXCLUDED.content_updated_at,link_depth=EXCLUDED.link_depth,evidence_source=EXCLUDED.evidence_source,updated_at=now()`,
        id,
        JSON.stringify(rows.slice(i, i + 500)),
      );
    }
  });
  return { accepted: rows.length, mode: 'upsert' };
}
