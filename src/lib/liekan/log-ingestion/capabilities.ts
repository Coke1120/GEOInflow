import { query } from '../upstream/server';
import { readAgentManifest } from './assets';
import { publicUrl } from './service';
import type { LogCapability, LogSetupCheck, LogSetupCheckId } from '../contracts/installation';
export type Capability = LogCapability;
export async function getLogCapabilities(): Promise<Record<'server' | 'cloudflare', Capability>> {
  const shared: LogSetupCheck[] = [];
  let origin: string | null = null;
  try {
    origin = publicUrl();
  } catch {}
  shared.push({ id: 'public-url', state: origin ? 'ready' : 'missing' });
  try {
    const ready = await query(
      "SELECT EXISTS(SELECT 1 FROM liekan_worker_state WHERE heartbeat_at>now()-interval '120 seconds') AS worker,EXISTS(SELECT 1 FROM liekan_queue_installation WHERE id='liekan_jobs' AND package_version='12.36.0') AS queue",
    );
    shared.push(
      { id: 'queue', state: ready[0]?.queue ? 'ready' : 'missing' },
      { id: 'worker', state: ready[0]?.worker ? 'ready' : 'missing' },
    );
  } catch {
    shared.push({ id: 'queue', state: 'unverified' }, { id: 'worker', state: 'unverified' });
  }
  let agentReady = false;
  try {
    await readAgentManifest();
    agentReady = true;
  } catch {}
  const key = Buffer.from(process.env.LIEKAN_LOG_CREDENTIALS_KEY || '', 'base64');
  const reasons: Record<LogSetupCheckId, string> = {
    'public-url': '管理员尚未配置公网 HTTPS 接收地址',
    queue: '日志队列尚未初始化',
    worker: '日志处理服务暂未就绪',
    'agent-package': '签名安装包尚未准备完成',
    'cloudflare-oauth': '管理员尚未配置 Cloudflare 授权服务',
    'credentials-key': '管理员尚未配置日志凭据加密密钥',
  };
  const capability = (checks: LogSetupCheck[]): Capability => {
    const pending = checks.find(check => check.state !== 'ready');
    return {
      available: !pending,
      reason: pending
        ? pending.state === 'unverified'
          ? '接收服务状态暂时无法读取，请重新检查'
          : reasons[pending.id]
        : null,
      version: '1',
      publicUrl: origin,
      checks,
    };
  };
  return {
    server: capability([
      ...shared,
      { id: 'agent-package', state: agentReady ? 'ready' : 'missing' },
    ]),
    cloudflare: capability([
      ...shared,
      {
        id: 'cloudflare-oauth',
        state:
          process.env.CLOUDFLARE_OAUTH_CLIENT_ID && process.env.CLOUDFLARE_OAUTH_CLIENT_SECRET
            ? 'ready'
            : 'missing',
      },
      { id: 'credentials-key', state: key.length === 32 ? 'ready' : 'missing' },
    ]),
  };
}
