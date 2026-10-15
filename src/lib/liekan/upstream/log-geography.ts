import { providerText } from '../geography/evidence';
import { getGeographyEvidence } from '@/lib/detect';
import { normalizeIp } from '@/lib/ip';
import { visitorGeographyLabel } from '../contracts/geography';
import { parseLogInput, type LogRecord } from '../ingest';
import { normalizeAutomatic } from '../log-ingestion/protocol';
import type { GeographyEvidence } from '../geography/evidence';

async function locateObserved(observed: { ip: string; record: LogRecord }[]) {
  // Bounded transient work. Raw addresses never enter returned records or durable jobs.
  for (let offset = 0; offset < observed.length; offset += 16) {
    await Promise.all(
      observed.slice(offset, offset + 16).map(async ({ ip, record }) => {
        const clean = normalizeIp(ip);
        const declared = providerText(record.location);
        record.declaredLocation = declared;
        record.location = declared || '未知';
        try {
          const evidence = await getGeographyEvidence({
            ip: clean,
            source: 'authenticated_server',
            trusted: true,
          });
          record.geography = evidence;
          if (!declared && evidence.precision !== 'missing')
            record.location = visitorGeographyLabel(evidence.location).slice(0, 80);
          else if (
            !!declared &&
            evidence.precision !== 'missing' &&
            declared !== visitorGeographyLabel(evidence.location)
          )
            record.geography = { ...evidence, reason: 'declared_location_differs' };
        } catch {
          /* Missing geography never invalidates an otherwise valid log. */
        }
      }),
    );
  }
}
export async function parseLogInputWithGeography(...args: Parameters<typeof parseLogInput>) {
  const observed: { ip: string; record: LogRecord }[] = [];
  const parsed = parseLogInput(args[0], args[1], args[2], args[3], args[4], (ip, record) =>
    observed.push({ ip, record }),
  );
  // parseLogInput calculates the original import digest before enrichment.
  await locateObserved(observed);
  return parsed;
}
export async function normalizeAutomaticWithGeography(
  ...args: Parameters<typeof normalizeAutomatic>
) {
  const observed: { ip: string; record: LogRecord }[] = [];
  const parsed = normalizeAutomatic(
    args[0],
    args[1],
    args[2],
    args[3],
    args[4],
    args[5],
    args[6],
    (ip, record) => observed.push({ ip, record }),
  );
  await locateObserved(observed);
  return parsed;
}
export async function persistLogGeography(tx: any, websiteId: string, records: LogRecord[]) {
  const rows = records
    .filter(r => r.geography)
    .map(r => ({ id: r.id, declared: r.declaredLocation || null, ...r.geography }));
  if (!rows.length) return;
  // Fence join reordering so fresh-table statistics cannot expand the batch to a site scan.
  await tx.$executeRawUnsafe(
    `INSERT INTO liekan_log_geography(log_id,website_id,country,region,city,declared_location,source,trust,ip_family,precision,reason,rule_version,data_version,city_id,accuracy_radius,country_basis,processed_at,shadow)
     SELECT r.id,$1::uuid,r.location->>'country',r.location->>'region',left(r.location->>'city',80),r.declared,r.source,r.trust,r."ipFamily",r.precision,r.reason,r."ruleVersion",r."dataVersion",r."cityId",r."accuracyRadius",r."countryBasis",r."processedAt"::timestamptz,r.shadow
     FROM jsonb_to_recordset($2::jsonb) AS r(id text,declared text,location jsonb,source text,trust text,"ipFamily" text,precision text,reason text,"ruleVersion" text,"dataVersion" text,"cityId" text,"accuracyRadius" integer,"countryBasis" text,"processedAt" text,shadow jsonb)
     JOIN LATERAL (SELECT 1 FROM liekan_log l
       WHERE l.website_id=$1::uuid AND l.id=r.id OFFSET 0) l ON true
     ON CONFLICT(website_id,log_id) DO NOTHING`,
    websiteId,
    JSON.stringify(rows),
  );
}
