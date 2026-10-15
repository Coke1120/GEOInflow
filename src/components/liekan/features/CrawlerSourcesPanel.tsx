'use client';
import { useState } from 'react';
import { useLiekanI18n } from '@/lib/liekan/i18n/client';
import type { CrawlerSourcesResponse } from '@/lib/liekan/contracts/crawler-maintenance';
import { useData, useFeature } from './context';
import { Badge, Body, Button, Notice, Panel, Table, Tabs } from './ui';

export function crawlerSourceStatus(status: string) {
  return (
    {
      healthy: '正常',
      missing: '尚无合格记录',
      stale: '证据已过期',
      review_required: '变化待复核',
      warning: '更新异常',
      update_failed: '最近检查失败',
    }[status] || '尚未读取'
  );
}
export function CrawlerSourcesPanel() {
  const c = useFeature(),
    i18n = useLiekanI18n();
  const [kind, setKind] = useState('ip');
  const query = useData<CrawlerSourcesResponse>(
    ['crawler-sources', c.user?.id],
    signal => c.api.get('/liekan/admin/crawler-sources', undefined, signal),
    !!c.user?.isAdmin,
  );
  if (!c.user?.isAdmin) return null;
  const data = query.error ? undefined : query.data;
  const rows = kind === 'ip' ? data?.ipSources : data?.documents;
  const date = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(i18n.locale, {
          dateStyle: 'short',
          timeStyle: 'short',
          timeZone: c.range.timezone,
        }).format(new Date(value))
      : '—';
  return (
    <Panel
      title={i18n.text('蜘蛛来源维护')}
      subtitle={i18n.text('IP 范围每小时检查，资料每七天检查；名称与用途经复核后随版本更新。')}
    >
      <Body>
        <Tabs
          items={[
            ['ip', i18n.text('IP 范围')],
            ['documents', i18n.text('资料检查')],
          ]}
          active={kind}
          onChange={setKind}
        />
        {query.error ? (
          <Notice tone="red">{i18n.text('无法读取来源状态，请重试。')}</Notice>
        ) : query.isPending ? (
          <Notice>{i18n.text('正在读取来源状态。')}</Notice>
        ) : (
          data && (
            <>
              <p className="field-help">{i18n.text('当前目录版本：{v0}', [data.catalogVersion])}</p>
              <Table
                mobile
                columns={['来源', '健康状态', '最近成功', '最近检查', '下次检查'].map(text =>
                  i18n.system(text),
                )}
                rowKeys={rows?.map(row => row.id)}
                rows={(rows || []).map(row => [
                  <div
                    key="source"
                    style={{ minWidth: 0, overflowWrap: 'anywhere', whiteSpace: 'normal' }}
                  >
                    <a href={row.url} target="_blank" rel="noopener noreferrer">
                      {'label' in row ? row.label : row.names.join(' / ')}
                    </a>
                    <details>
                      <summary>{i18n.text('查看版本与复核信息')}</summary>
                      <p>{i18n.text('人工复核日期：{v0}', [row.reviewedAt])}</p>
                      <p>
                        {i18n.text('当前版本：{v0}', [
                          ('version' in row ? row.version : row.currentHash) || '—',
                        ])}
                      </p>
                      <p>{i18n.text('连续失败：{v0}', [row.consecutiveFailures])}</p>
                      {row.errorCode && <p>{i18n.text('检查结果：{v0}', [row.errorCode])}</p>}
                      {'candidateVersion' in row && row.candidateVersion && (
                        <p>{i18n.text('待复核版本：{v0}', [row.candidateVersion])}</p>
                      )}
                    </details>
                  </div>,
                  <div key="status">
                    <Badge
                      tone={
                        row.status === 'healthy'
                          ? 'green'
                          : row.status === 'missing'
                            ? 'gray'
                            : 'amber'
                      }
                    >
                      {i18n.system(crawlerSourceStatus(row.status))}
                    </Badge>
                    {row.reviewOverdue && (
                      <p className="field-help">{i18n.text('人工复核已超过 45 天')}</p>
                    )}
                  </div>,
                  date(row.lastSuccessAt),
                  date(row.lastAttemptAt),
                  date(row.nextCheckAt),
                ])}
                empty={i18n.text('尚无来源记录')}
              />
            </>
          )
        )}
        <Button disabled={query.isFetching} onClick={() => query.refetch()}>
          {i18n.text('重新读取状态')}
        </Button>
        <p className="field-help">
          {i18n.text(
            '异常更新保留上次合格范围；变化候选需要维护者复核。读取状态不会触发外部抓取。',
          )}
        </p>
      </Body>
    </Panel>
  );
}
