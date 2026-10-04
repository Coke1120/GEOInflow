import {
  type InstallationProgress,
  type InstallationStatus,
  initialInstallationProgress,
  installationActionSchema,
} from './contracts/installation';
import {
  LiekanError,
  lockWritableWebsite,
  query,
  transaction,
  type WriteIdentity,
} from './upstream/server';

import { getLogCapabilities } from './log-ingestion/capabilities';
import { listSources } from './log-ingestion/service';
const progressQuery = `SELECT method,last_step AS "lastStep",browser_check_deferred AS "browserCheckDeferred",
  log_check_deferred AS "logCheckDeferred",completed_at AS "completedAt"
  FROM liekan_installation WHERE website_id=$1::uuid`;
function progressFromRow(row?: InstallationProgress): InstallationProgress {
  return row
    ? {
        ...initialInstallationProgress(),
        ...row,
        completedAt: row.completedAt ? new Date(row.completedAt).toISOString() : null,
      }
    : initialInstallationProgress();
}
export async function getInstallation(id: string, canManage: boolean): Promise<InstallationStatus> {
  const [rows, logs] = await Promise.all([
    query<InstallationProgress>(progressQuery, id),
    query<InstallationStatus['logs']>(
      `SELECT
      (SELECT count(*)::int FROM liekan_effective_log WHERE website_id=$1::uuid) AS total,
      (SELECT count(*)::int FROM liekan_effective_log WHERE website_id=$1::uuid AND bot_type IN ('训练','搜索','用户触发')) AS ai,
      (SELECT max(created_at) FROM liekan_effective_log WHERE website_id=$1::uuid) AS "latestAt",
      (SELECT max(imported_at) FROM liekan_import WHERE website_id=$1::uuid) AS "latestImportAt",
      COALESCE((SELECT is_demo FROM liekan_setting WHERE website_id=$1::uuid),false) AS demo`,
      id,
    ),
  ]);
  const availability=await getLogCapabilities();
  const sources=await listSources(id).catch(()=>[]);
  return {
    progress: progressFromRow(rows[0]),
    canManage,
    logs: logs[0],
    capabilities: { cloudflare: availability.cloudflare.available, server: availability.server.available },
    availability, sources,
  };
}
export async function saveInstallation(id: string, body: unknown, identity: WriteIdentity) {
  const parsed = installationActionSchema.safeParse(body);
  if (!parsed.success) throw new LiekanError('接入设置格式无效');
  const action = parsed.data;
  return transaction(async tx => {
    await lockWritableWebsite(tx, id, identity);
    const current = progressFromRow((await tx.$queryRawUnsafe(progressQuery, id))[0]);
    const next = { ...current };
    if ('method' in action) next.method = action.method;
    if (action.action === 'select-method') next.lastStep = 'logs';
    if (action.action === 'continue') next.lastStep = action.step;
    if (action.action === 'skip-browser') {
      next.browserCheckDeferred = true;
      next.lastStep = 'logs';
    }
    if (action.action === 'skip-logs') {
      next.logCheckDeferred = true;
      next.lastStep = 'finish';
    }
    if (action.action === 'skip-checks') {
      next.browserCheckDeferred = true;
      next.logCheckDeferred = true;
      next.lastStep = 'finish';
    }
    if (action.action === 'finish') {
      next.completedAt ||= new Date().toISOString();
      next.lastStep = 'finish';
    }
    await tx.$executeRawUnsafe(
      `INSERT INTO liekan_installation
      (website_id,method,browser_check_deferred,log_check_deferred,completed_at,last_step)
      VALUES ($1::uuid,$2,$3,$4,$5::timestamptz,$6)
      ON CONFLICT(website_id) DO UPDATE SET method=$2,browser_check_deferred=$3,
      log_check_deferred=$4,completed_at=$5::timestamptz,last_step=$6,updated_at=now()`,
      id,
      next.method,
      next.browserCheckDeferred,
      next.logCheckDeferred,
      next.completedAt,
      next.lastStep,
    );
    return { progress: next };
  });
}
