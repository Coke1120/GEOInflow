'use client';
import { useEffect, useState, useRef } from 'react';
import type { TrafficAudit, BrowserRiskReport } from '@/lib/liekan/contracts/traffic-quality';
import type { TrafficExclusionResult } from '@/lib/liekan/contracts/traffic-exclusions';
import { useLiekanI18n } from '@/lib/liekan/i18n/client';
import { useFeature } from './context';
import { Body, Button, Notice, Panel, Table } from './ui';

export function TrafficGovernance({
  audit,
  findings,
  canManage,
  refresh,
}: {
  audit: TrafficAudit;
  findings: BrowserRiskReport['findings'];
  canManage: boolean;
  refresh: () => Promise<unknown>;
}) {
  const c = useFeature(),
    i18n = useLiekanI18n();
  const [preview, setPreview] = useState<TrafficExclusionResult | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const governance = audit.governance;
  const scope = `${c.siteId}:${governance?.revision}:${governance?.epoch}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [older, setOlder] = useState<NonNullable<TrafficAudit['governance']>['collections']>([]);
  const [nextCursor, setNextCursor] = useState(governance?.nextCursor);

  useEffect(() => {
    setPreview(null);
    setError('');
    setOlder([]);
    setNextCursor(governance?.nextCursor);
  }, [scope, governance?.nextCursor]);
  if (!governance) return null;
  const endpoint = `/liekan/websites/${c.siteId}/traffic-quality/exclusions`;
  const operate = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    try {
      const result = await c.api.post<TrafficExclusionResult>(endpoint, {
        ...body,
        expectedRevision: governance.revision,
      });
      if (result.action === 'preview') setPreview(result);
      else {
        setPreview(null);
        await refresh();
        await c.refresh();
      }
    } catch (e: any) {
      setPreview(null);
      setError(e.message || '操作失败');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel
      title={i18n.text('已确认的流量排除')}
      subtitle={i18n.text(
        '完整观察窗口可预览并确认排除。撤销后重新按当前规则统计；其他生效集合继续有效。',
      )}
    >
      <Body>
        <p className="muted">
          {i18n.text('治理版本 {v0}；仅管理权限可以确认或撤销。', [governance.revision])}
        </p>
        {error && <Notice>{i18n.system(error)}</Notice>}
        {preview && (
          <div role="status">
            <p>
              {i18n.text('将排除 {v0} 条浏览器事件，其中浏览 PV 为 {v1}。预览于 {v2} 失效。', [
                preview.evidence?.events,
                preview.evidence?.pageviews,
                new Date(preview.expiresAt!).toLocaleString(i18n.locale),
              ])}
            </p>
            <Button
              disabled={busy || !canManage || Date.parse(preview.expiresAt!) <= Date.now()}
              onClick={() =>
                operate({ action: 'confirm', previewId: preview.id, digest: preview.digest })
              }
            >
              {i18n.text('确认排除这些事件')}
            </Button>
            <Button disabled={busy} onClick={() => setPreview(null)}>
              {i18n.text('取消')}
            </Button>
          </div>
        )}
      </Body>
      <Table
        columns={['候选窗口', '候选访问', '操作']}
        rows={(findings || []).map(finding => {
          const { windowEnd, sessionId, visitId } = finding;
          return [
            new Date(windowEnd).toLocaleString(i18n.locale),
            visitId.slice(0, 8),
            <Button
              key={`${windowEnd}:${sessionId}:${visitId}`}
              disabled={busy || !canManage}
              onClick={() =>
                operate({ action: 'preview', windowEnd, visits: [{ sessionId, visitId }] })
              }
            >
              {i18n.text('预览排除')}
            </Button>,
          ];
        })}
        empty={i18n.text('当前范围没有可确认的完整候选窗口')}
      />
      <Table
        columns={['确认时间', '事件数', '状态', '操作']}
        numeric={[1]}
        rows={[...governance.collections, ...older].map(item => [
          new Date(item.confirmedAt || item.createdAt).toLocaleString(i18n.locale),
          item.evidence.events,
          i18n.text(
            item.epoch !== governance.epoch
              ? '历史周期'
              : item.state === 'active'
                ? '生效中'
                : '已撤销',
          ),
          item.state === 'active' && item.epoch === governance.epoch ? (
            <Button
              key={item.id}
              disabled={busy || !canManage}
              onClick={() => operate({ action: 'revoke', collectionId: item.id })}
            >
              {i18n.text('撤销排除')}
            </Button>
          ) : null,
        ])}
        empty={i18n.text('尚无已确认的排除集合')}
      />
      {nextCursor && (
        <Body>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              const requestedScope = scope;
              try {
                const page = await c.api.get<NonNullable<TrafficAudit['governance']>>(endpoint, {
                  cursor: nextCursor,
                });
                if (currentScope.current === requestedScope) {
                  setOlder(values => [...values, ...page.collections]);
                  setNextCursor(page.nextCursor);
                }
              } catch (e: any) {
                if (currentScope.current === requestedScope) setError(e.message || '操作失败');
              } finally {
                setBusy(false);
              }
            }}
          >
            {i18n.text('加载更多排除记录')}
          </Button>
        </Body>
      )}
    </Panel>
  );
}
