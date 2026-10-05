'use client';
import { useEffect, useRef, useState } from 'react';
import {
  logPublicOrigin,
  type InstallationStatus,
  type LogCapability,
  type LogSetupCheckId,
} from '@/lib/liekan/contracts/installation';
import { useFeature } from './context';
import { Badge, Button, Code, Field, Form, LiekanDialog, Notice } from './ui';
import styles from '@/styles/liekan/Installation.module.css';

const setupLabels: Record<LogSetupCheckId, string> = {
  'public-url': '公网 HTTPS 地址',
  queue: '日志队列',
  worker: '日志处理服务',
  'agent-package': '签名安装包',
  'cloudflare-oauth': 'Cloudflare 授权应用',
  'credentials-key': '凭据加密密钥',
};
function ReceiverSetupGuide({
  method,
  capability,
  available,
  refresh,
}: {
  method: 'server' | 'cloudflare';
  capability?: LogCapability;
  available: boolean;
  refresh: () => Promise<unknown>;
}) {
  const c = useFeature();
  const [draft, setDraft] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const value = draft ?? capability?.publicUrl ?? '';
  const origin = logPublicOrigin(value.trim());
  const checks = capability?.checks ?? [];
  const missing = (id: LogSetupCheckId) =>
    checks.find(check => check.id === id)?.state === 'missing';
  const credentialConfig = [
    ...(missing('cloudflare-oauth')
      ? ['CLOUDFLARE_OAUTH_CLIENT_ID=填写应用ID', 'CLOUDFLARE_OAUTH_CLIENT_SECRET=填写应用密钥']
      : []),
    ...(missing('credentials-key')
      ? ['LIEKAN_LOG_CREDENTIALS_KEY=填写32字节随机密钥的Base64']
      : []),
  ].join('\n');
  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    if (active.current) c.notify('配置说明已复制');
  };
  return (
    <section className={styles.setupGuide} aria-label="接收服务配置引导">
      <div>
        <h3>配置日志接收服务</h3>
        <p className="muted">
          由部署管理员配置一次，供本实例的所有网站使用。填写地址后，按下方步骤应用到部署环境。
        </p>
        {!c.user?.isAdmin && (
          <Notice tone="amber">
            请将配置说明交给部署管理员。你可以在这里查看要求，并在配置完成后重新检查。
          </Notice>
        )}
        {!checks.length && (
          <Notice tone="amber">
            当前服务尚未返回逐项检查结果。请重新检查，并由部署管理员确认已有配置后再修改。
          </Notice>
        )}
      </div>
      <div className="stack">
        <strong>1. 准备统计服务的公网地址</strong>
        <Field
          label="统计服务公网地址"
          aria-label="统计服务公网地址"
          type="url"
          placeholder="https://stats.example.com"
          maxLength={255}
          value={value}
          onChange={event => {
            setDraft(event.target.value);
            setChecked(false);
          }}
          help="填写猎看统计的访问域名。域名需指向统计服务，配置有效的 HTTPS 证书，并允许外部访问日志接收接口。"
          error={
            value && !origin
              ? '请输入 HTTPS 根地址，使用公网域名，去掉路径、参数和账号信息。'
              : undefined
          }
        />
        {origin && <Code>{`LIEKAN_PUBLIC_URL=${origin}`}</Code>}
        <div className="row">
          <Button disabled={!origin} onClick={() => copy(`LIEKAN_PUBLIC_URL=${origin}`)}>
            复制地址配置
          </Button>
        </div>
        <p className="field-help">
          Docker 部署：更新猎看部署目录的 .env
          中对应项。其他部署：在托管平台的环境变量中更新。页面填写用于生成配置说明。
        </p>
        {capability?.publicUrl && (
          <p className="field-help">当前运行地址：{capability.publicUrl}</p>
        )}
      </div>
      {method === 'cloudflare' && (
        <div className="stack">
          <strong>2. 配置 Cloudflare 授权应用</strong>
          <p>
            在 Cloudflare 账户的 Manage Account → OAuth clients 创建服务器端应用，使用 Authorization
            Code 流程和 client_secret_basic，配置读取 Zone 与管理 Logpush 所需权限。
          </p>
          <a
            href="https://developers.cloudflare.com/fundamentals/oauth/create-an-oauth-client/"
            target="_blank"
            rel="noreferrer"
          >
            查看 Cloudflare 官方配置指南 ↗
          </a>
          <span className="field-help">将以下地址登记为应用的回调地址：</span>
          {origin ? (
            <>
              <Code>{`${origin}/api/liekan/oauth/cloudflare/callback`}</Code>
              <div className="row">
                <Button onClick={() => copy(`${origin}/api/liekan/oauth/cloudflare/callback`)}>
                  复制回调地址
                </Button>
              </div>
            </>
          ) : (
            <p className="muted">填写有效的公网地址后显示回调地址。</p>
          )}
          {(missing('cloudflare-oauth') || missing('credentials-key')) && (
            <>
              <p className="field-help">
                在部署环境补齐下列待配置项，用真实值替换占位文字；应用密钥和加密密钥由部署管理员保管。
              </p>
              <Code>{credentialConfig}</Code>
              <div className="row">
                <Button onClick={() => copy(credentialConfig)}>复制待配置项</Button>
              </div>
              {missing('credentials-key') && (
                <details>
                  <summary>如何生成凭据加密密钥</summary>
                  <p className="field-help">
                    在部署服务器运行下方命令，将结果填入对应环境变量；已有密钥请保留，轮换需按部署文档执行。
                  </p>
                  <Code>{`node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))"`}</Code>
                </details>
              )}
            </>
          )}
        </div>
      )}
      <div className="stack">
        <strong>{method === 'cloudflare' ? '3' : '2'}. 应用配置并重新检查</strong>
        <p>
          应用与日志处理服务需使用同一份配置。Docker
          部署在猎看部署目录执行下方命令；其他部署请更新并重启这两个进程。
        </p>
        <p className="field-help">配置完成后，通过该公网域名打开猎看，再继续授权或安装。</p>
        <Code>docker compose -f docker-compose.liekan.yml up -d --no-deps app log-worker</Code>
        {missing('queue') && (
          <details>
            <summary>日志队列待初始化或无法读取</summary>
            <p className="field-help">
              确认数据库可连接、增量迁移已完成，再由部署管理员初始化队列。
            </p>
            <Code>
              {
                'docker compose -f docker-compose.liekan.yml exec app node scripts/liekan-queue-bootstrap.mjs'
              }
            </Code>
          </details>
        )}
        {method === 'server' && missing('agent-package') && (
          <details>
            <summary>准备签名安装包</summary>
            <p className="field-help">
              在受控构建环境设置 LIEKAN_AGENT_SIGNING_KEY_FILE，执行下方命令，再重新构建并部署包含
              public/liekan-agent 的应用镜像。
            </p>
            <Code>pnpm liekan:build-agent</Code>
          </details>
        )}
        <div className={styles.setupChecks} aria-label="当前运行配置">
          {checks.map(check => (
            <div key={check.id}>
              <span>{setupLabels[check.id]}</span>
              <Badge tone={check.state === 'ready' ? 'green' : 'gray'}>
                {check.state === 'ready'
                  ? '已就绪'
                  : check.state === 'unverified'
                    ? '未能读取'
                    : '待配置'}
              </Badge>
            </div>
          ))}
        </div>
        <p className="field-help">
          检查核对运行中的配置、服务心跳和安装资产。公网连通性与真实日志到达可在连接后继续检查。
        </p>
        <div className="row">
          <Button
            primary
            disabled={checking}
            onClick={async () => {
              setChecking(true);
              setError('');
              setChecked(false);
              try {
                const result: any = await refresh();
                if (result?.error) throw result.error;
                if (active.current) setChecked(true);
              } catch (e) {
                if (active.current)
                  setError(e instanceof Error ? e.message : '配置读取失败，请重试。');
              } finally {
                if (active.current) setChecking(false);
              }
            }}
          >
            {checking ? '正在检查配置…' : '重新检查配置'}
          </Button>
        </div>
        <div aria-live="polite">
          {checked && (
            <p className="field-help">
              {available
                ? '接收服务已就绪，可以继续生成授权链接或安装命令。'
                : '已重新读取运行配置，请继续完成上方待配置项。'}
            </p>
          )}
        </div>
        {error && <Notice tone="red">{error}</Notice>}
      </div>
    </section>
  );
}

export function AutomaticLogSetup({
  websiteId,
  method,
  status,
  manage,
  refresh,
}: {
  websiteId: string;
  method: 'server' | 'cloudflare';
  status: InstallationStatus;
  manage: boolean;
  refresh: () => Promise<unknown>;
}) {
  const c = useFeature();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [command, setCommand] = useState<{ command: string; expiresAt: string } | null>(null);
  const [authorization, setAuthorization] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [zones, setZones] = useState<{
    domain: string;
    zones: { id: string; name: string }[];
  } | null>(null);
  const [zone, setZone] = useState(''),
    [costs, setCosts] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const available = !!status.capabilities[method];
  const reason = status.availability?.[method]?.reason || '当前实例尚未配置此接入服务。';
  const sources = (status.sources || []).filter(source => source.kind === method);
  const [disconnect, setDisconnect] = useState<{ id: string; domain: string } | null>(null);
  useEffect(() => setDisconnect(null), [websiteId, method]);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (error) {
      if (alive.current) setError(error instanceof Error ? error.message : '操作失败，请重试。');
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  useEffect(() => {
    if (!sources.some(source => source.state === 'configuring')) return;
    const timer = setInterval(() => {
      void refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [websiteId, method, sources.some(source => source.state === 'configuring')]);
  const flowId = c.query.flow;
  useEffect(() => {
    if (method !== 'cloudflare' || !flowId || !manage) return;
    let cancelled = false;
    setBusy(true);
    c.api
      .post(`/liekan/websites/${websiteId}/log-sources/cloudflare/finalize`, { flowId })
      .then((data: any) => {
        if (cancelled) return;
        if (data.sourceId) {
          void refresh();
          return;
        }
        setZones(data);
        setZone(data.zones?.[0]?.id || '');
      })
      .catch(error => {
        if (!cancelled) setError(error.message || '授权确认读取失败。');
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [flowId, websiteId, method, manage]);
  return (
    <>
      <p className="muted">{available ? '按下方引导完成连接，检查可稍后进行。' : reason}</p>
      {!available && (
        <p className="field-help">
          先完成实例配置，再为当前网站连接日志来源。下方引导可直接查看待配置项和操作步骤。
        </p>
      )}
      <div className="form-actions">
        {!available ? (
          <Button primary aria-expanded={setupOpen} onClick={() => setSetupOpen(!setupOpen)}>
            {setupOpen ? '收起配置引导' : c.user?.isAdmin ? '开始配置' : '查看配置说明'}
          </Button>
        ) : (
          <>
            <Button
              primary
              disabled={!available || !manage || busy}
              onClick={() =>
                run(async () => {
                  const data: any = await c.api.post(
                    `/liekan/websites/${websiteId}/log-sources/${method === 'server' ? 'server/pairing' : 'cloudflare/start'}`,
                    {},
                  );
                  if (!alive.current) return;
                  if (method === 'server') setCommand(data);
                  else setAuthorization(data.authorizationUrl);
                })
              }
            >
              {busy ? '正在处理…' : method === 'server' ? '生成一次安装命令' : '生成授权链接'}
            </Button>
            <Button aria-expanded={setupOpen} onClick={() => setSetupOpen(!setupOpen)}>
              {setupOpen ? '收起配置引导' : '查看接收服务配置'}
            </Button>
          </>
        )}
      </div>
      {setupOpen && (
        <ReceiverSetupGuide
          method={method}
          capability={status.availability?.[method]}
          available={available}
          refresh={refresh}
        />
      )}
      {command && (
        <div className="stack">
          <p>在网站服务器执行。安装会询问当前网站的日志路径，并在本机校验读取权限。</p>
          <Code>{command.command}</Code>
          <p className="field-help">
            命令仅可配对一次，失效时间：{new Date(command.expiresAt).toLocaleTimeString('zh-CN')}
            。支持 Ubuntu 22.04/24.04、Debian 12，Nginx / Apache Combined 日志。
          </p>
          <Button
            onClick={async () => {
              await navigator.clipboard.writeText(command.command);
              c.notify('安装命令已复制');
            }}
          >
            复制安装命令
          </Button>
        </div>
      )}
      {authorization && (
        <div className="stack">
          <p>前往 Cloudflare 选择账户并授权，返回后确认网站域名。</p>
          <Button primary onClick={() => window.location.assign(authorization)}>
            前往 Cloudflare 授权
          </Button>
        </div>
      )}
      {zones && (
        <div className="stack">
          <label>
            匹配网站域名：{zones.domain}
            <select
              aria-label="Cloudflare 域名"
              value={zone}
              onChange={event => setZone(event.target.value)}
            >
              {zones.zones.map(row => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <label className="row">
            <input
              type="checkbox"
              checked={costs}
              onChange={event => setCosts(event.target.checked)}
            />
            我已了解：Logpush 需要账户支持，供应商可能收费；连接成功后将成为主要日志来源。
          </label>
          <Button
            primary
            disabled={busy || !costs || !zone}
            onClick={() =>
              run(async () => {
                await c.api.post(`/liekan/websites/${websiteId}/log-sources/cloudflare/finalize`, {
                  flowId,
                  zoneId: zone,
                  acceptCosts: true,
                });
                if (!alive.current) return;
                setZones(null);
                await refresh();
                c.notify('连接已保存，正在配置日志推送');
              })
            }
          >
            确认并连接
          </Button>
        </div>
      )}
      {sources.map(source => (
        <div className={styles.entryRow} key={source.id}>
          <div>
            <strong>{source.domain}</strong>{' '}
            <Badge tone={source.primary ? 'blue' : 'gray'}>
              {source.primary
                ? '主要来源'
                : {
                    configuring: '配置中',
                    paused: '已暂停',
                    error: '需要处理',
                    active: '已连接',
                    disconnected: '正在断开',
                  }[source.state] || source.state}
            </Badge>
            <p className="muted">
              连接：
              {source.lastHeartbeatAt
                ? Date.now() - new Date(source.lastHeartbeatAt).getTime() > 180000
                  ? '连接状态已过期'
                  : '已报告状态'
                : '等待连接'}{' '}
              · 真实日志：{source.lastReceivedAt ? '已接收' : '等待接收'} · 处理：
              {source.lastProcessedAt ? '已处理' : '等待处理'} · 积压 {source.backlog} 批
            </p>
            {!!source.failed && (
              <p role="alert">
                有 {source.failed}{' '}
                批日志处理失败，请核对事件格式或来源配置。已接收的其他批次会继续处理。
              </p>
            )}
            {source.cleanupPending && (
              <p role="alert">
                正在停用远端日志任务。若供应商授权已失效，请到 Cloudflare 核对停用结果。
              </p>
            )}
            {source.errorCode && (
              <p role="alert">
                {source.errorCode === 'confirmation-required'
                  ? '主要来源已变更；确认后可将此连接设为主要来源。'
                  : source.errorCode === 'reauthorization-required'
                    ? '授权或网站配置已变更，请重新连接。'
                    : '日志推送暂时异常，请检查服务与权限。'}
              </p>
            )}
            {source.health?.gap === true && (
              <p role="alert">采集器报告了日志轮转或重置缺口，请核对日志保留情况。</p>
            )}
            {source.health?.errorCode === 'buffer-full' && (
              <p role="alert">本机缓冲已满或超过保留时间，读取已暂停；恢复连接后会继续发送。</p>
            )}
          </div>
          {manage && (
            <div className="row">
              <Button
                disabled={
                  busy ||
                  source.state === 'configuring' ||
                  source.state === 'disconnected' ||
                  source.cleanupPending
                }
                onClick={() =>
                  run(async () => {
                    await c.api.put(`/liekan/websites/${websiteId}/log-sources/${source.id}`, {
                      action: source.primary ? 'pause' : 'select',
                    });
                    await refresh();
                  })
                }
              >
                {source.primary ? '暂停' : '设为主要来源'}
              </Button>
              <Button
                disabled={busy}
                onClick={() => setDisconnect({ id: source.id, domain: source.domain })}
              >
                断开连接
              </Button>
            </div>
          )}
        </div>
      ))}
      {disconnect && (
        <LiekanDialog
          title="断开日志连接"
          subtitle={disconnect.domain}
          protectUnsaved={false}
          onClose={() => !busy && setDisconnect(null)}
        >
          <Form
            busy={busy}
            danger
            trackUnsaved={false}
            submitLabel="断开连接"
            cancel={
              <Button disabled={busy} onClick={() => setDisconnect(null)}>
                保留连接
              </Button>
            }
            onSubmit={async () => {
              if (!manage || !sources.some(source => source.id === disconnect.id))
                throw new Error('连接或权限已变更，请重新读取后再操作。');
              setBusy(true);
              try {
                await c.api.del(`/liekan/websites/${websiteId}/log-sources/${disconnect.id}`);
                await refresh();
                if (alive.current) {
                  setDisconnect(null);
                  c.notify('日志连接已断开');
                }
              } finally {
                if (alive.current) setBusy(false);
              }
            }}
          >
            <Notice tone="amber">
              断开「{disconnect.domain}」的{method === 'server' ? '服务器采集' : 'Cloudflare'}
              日志连接后，该来源将停止接收新日志。历史数据继续保留。
            </Notice>
            {method === 'server' && (
              <p className="muted">服务器采集服务可由管理员在对应服务器卸载。</p>
            )}
          </Form>
        </LiekanDialog>
      )}
      {error && <Notice tone="red">{error}</Notice>}
      {sources.length > 0 && (
        <p className="field-help">
          每个网站使用一个主要自动来源；选择新来源会暂停之前的来源。同一时间的源站、CDN
          与手动导入数据按生效区间统计。
        </p>
      )}
    </>
  );
}
