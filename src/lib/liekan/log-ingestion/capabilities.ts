import { query } from '../upstream/server';
import { readAgentManifest } from './assets';
import { publicUrl } from './service';
export interface Capability {
  available: boolean;
  reason: string | null;
  version: string;
}
export async function getLogCapabilities(): Promise<Record<'server' | 'cloudflare', Capability>> {
  const base = { available: false, reason: '接收服务尚未准备完成', version: '1' };
  const result = { server: { ...base }, cloudflare: { ...base } };
  try {
    publicUrl();
  } catch {
    result.server.reason = result.cloudflare.reason = '管理员尚未配置公网 HTTPS 接收地址';
    return result;
  }
  try {
    const ready = await query(
      "SELECT EXISTS(SELECT 1 FROM liekan_worker_state WHERE heartbeat_at>now()-interval '120 seconds') AS worker,EXISTS(SELECT 1 FROM liekan_queue_installation WHERE id='liekan_jobs' AND package_version='12.36.0') AS queue",
    );
    if (!ready[0]?.queue || !ready[0]?.worker) {
      result.server.reason = result.cloudflare.reason = '日志处理服务暂未就绪';
      return result;
    }
  } catch {
    return result;
  }
  try {
    await readAgentManifest();
    result.server = { available: true, reason: null, version: '1' };
  } catch {
    result.server.reason = '签名安装包尚未准备完成';
  }
  const key = Buffer.from(process.env.LIEKAN_LOG_CREDENTIALS_KEY || '', 'base64');
  if (
    process.env.CLOUDFLARE_OAUTH_CLIENT_ID &&
    process.env.CLOUDFLARE_OAUTH_CLIENT_SECRET &&
    key.length === 32
  )
    result.cloudflare = { available: true, reason: null, version: '1' };
  else result.cloudflare.reason = '管理员尚未配置 Cloudflare 授权服务';
  return result;
}
