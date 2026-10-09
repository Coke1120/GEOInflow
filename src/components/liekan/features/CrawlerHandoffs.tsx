'use client';
import { useEffect, useState } from 'react';
import { featureRequest } from '@/lib/liekan/upstream/features-client';
import type {
  CrawlerConnection,
  CrawlerDeployment,
  CrawlerPolicy,
} from '@/lib/liekan/contracts/crawlers';
import { Button, LiekanDialog, Notice, Select, Table } from './ui';
type Recovery = {
  websiteId: string;
  connectionId: string;
  websiteName: string;
  domain: string;
  zoneId: string;
};
type Handoff = {
  connection: CrawlerConnection;
  policies: CrawlerPolicy[];
  deployments: CrawlerDeployment[];
  instruction: string;
  recoveryConnections: Recovery[];
};
export function CrawlerHandoffs({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<Handoff[] | null>(null),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<{ row: Handoff; deployment: CrawlerDeployment } | null>(
      null,
    ),
    [connectionId, setConnectionId] = useState(''),
    [acknowledged, setAcknowledged] = useState(false),
    [notApplied, setNotApplied] = useState(false),
    [result, setResult] = useState<CrawlerDeployment | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    setError('');
    void featureRequest<{ handoffs: Handoff[] }>(
      'GET',
      '/liekan/crawler-handoffs',
      undefined,
      abort.signal,
    )
      .then(result => {
        if (!abort.signal.aborted) setRows(result.handoffs);
      })
      .catch(error => {
        if (!abort.signal.aborted) setError(error.message);
      });
    return () => abort.abort();
  }, [revision]);
  async function reconcile() {
    const connection = selected?.row.recoveryConnections.find(
      row => row.connectionId === connectionId,
    );
    if (!selected || !connection || !acknowledged || busy) return;
    setBusy(true);
    setError('');
    try {
      setResult(
        await featureRequest<CrawlerDeployment>('POST', '/liekan/crawler-handoffs/reconcile', {
          deploymentId: selected.deployment.id,
          websiteId: connection.websiteId,
          connectionId: connection.connectionId,
          acknowledgeHandoff: true,
          acknowledgeNotApplied: notApplied,
        }),
      );
      setRevision(value => value + 1);
    } catch (error: any) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <LiekanDialog
      title="蜘蛛规则交接记录"
      subtitle="当前账户及仍可访问的原团队范围"
      size="wide"
      onClose={onClose}
    >
      <Notice>
        断开、域名变更与网站删除会保留远端规则。这里列出规则身份与待确认操作，便于原 Zone
        管理者核对；本地凭据销毁后，请在 Cloudflare 撤销不用的 Token。
      </Notice>
      {error && (
        <Notice tone="red">
          {error}
          <Button onClick={() => setRevision(value => value + 1)}>重新读取</Button>
        </Notice>
      )}
      {!rows && !error && <Notice>正在读取交接记录</Notice>}
      {rows?.map(row => (
        <section key={row.connection.id}>
          <h3>
            {row.connection.domain} · {row.connection.zoneId}
          </h3>
          <p>{row.instruction}</p>
          <Table
            columns={['策略', '规则 ID / ref', '当前登记']}
            rows={row.policies.map(policy => [
              policy.name,
              `${policy.remoteRuleId || '未登记'} / ${policy.ref}`,
              policy.state === 'enabled'
                ? '配置已启用'
                : policy.state === 'stopped'
                  ? '配置已停用'
                  : '草稿',
            ])}
            empty="此连接没有已登记策略"
          />
          <Table
            columns={['操作 ID', '操作 / 版本', '结果']}
            rows={row.deployments.map(deployment => [
              deployment.id,
              `${deployment.operation} / ${deployment.policyVersion}`,
              <>
                {deployment.state === 'unknown'
                  ? '结果待确认，请核对远端'
                  : deployment.state === 'confirmed'
                    ? '已回读一致'
                    : `${deployment.state} · ${deployment.errorCode || ''}`}
                {deployment.state === 'unknown' && (
                  <Button
                    disabled={busy || !row.recoveryConnections.length}
                    onClick={() => {
                      setSelected({ row, deployment });
                      setConnectionId('');
                      setAcknowledged(false);
                      setNotApplied(false);
                      setResult(null);
                    }}
                  >
                    选择连接并只读核对
                  </Button>
                )}
              </>,
            ])}
            empty="暂无部署记录"
          />
          {row.deployments.some(deployment => deployment.state === 'unknown') &&
            !row.recoveryConnections.length && (
              <Notice tone="amber">
                当前范围缺少可用于恢复的同域名、同 Zone 活跃连接。请在有控制权限的网站连接独立 Token
                后重新读取。
              </Notice>
            )}
        </section>
      ))}
      {selected && (
        <section>
          <h3>明确核对旧操作结果</h3>
          <p>
            操作 {selected.deployment.id} · {selected.row.connection.domain}
          </p>
          <Select
            label="用于读取的当前连接"
            value={connectionId}
            disabled={busy}
            options={[
              ['', '选择网站与连接'],
              ...selected.row.recoveryConnections.map(
                row => [row.connectionId, `${row.websiteName} · ${row.domain}`] as [string, string],
              ),
            ]}
            onChange={event => setConnectionId(event.target.value)}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={busy}
              onChange={event => setAcknowledged(event.target.checked)}
            />
            我确认使用所选连接只读核对原规则，不取得原规则的写入权限。
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={notApplied}
              disabled={busy}
              onChange={event => setNotApplied(event.target.checked)}
            />
            若远端与操作前状态完全一致，确认本次未应用并结束待确认任务。
          </label>
          <Button primary disabled={busy || !acknowledged || !connectionId} onClick={reconcile}>
            只读核对并登记结果
          </Button>
          {result && (
            <Notice tone={result.state === 'unknown' || result.state === 'conflict' ? 'amber' : ''}>
              核对结果：
              {result.state === 'confirmed'
                ? '远端已回读一致'
                : result.state === 'failed'
                  ? '已明确结束原任务'
                  : result.state === 'unknown'
                    ? '仍待确认'
                    : result.state}
              {result.errorCode && ` · ${result.errorCode}`}
            </Notice>
          )}
        </section>
      )}
      {rows?.length === 0 && <Notice>当前范围没有待交接的连接。</Notice>}
    </LiekanDialog>
  );
}
