'use client';
import { useEffect, useRef, useState } from 'react';
import type { InstallationStatus } from '@/lib/liekan/contracts/installation';
import { useFeature } from './context';
import { Badge, Button, Code, Notice } from './ui';
import styles from '@/styles/liekan/Installation.module.css';

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
      <div className="form-actions">
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
      </div>
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
                onClick={() =>
                  run(async () => {
                    if (
                      !window.confirm(
                        `断开 ${source.domain} 的此日志来源？历史数据将保留，服务器采集服务仍可在本机卸载。`,
                      )
                    )
                      return;
                    await c.api.del(`/liekan/websites/${websiteId}/log-sources/${source.id}`);
                    await refresh();
                  })
                }
              >
                断开连接
              </Button>
            </div>
          )}
        </div>
      ))}
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
