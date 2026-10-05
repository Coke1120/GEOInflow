'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useAction, useData, useFeature } from './context';
import { Body, Button, LinkButton, Notice, Panel, QueryState } from './ui';

export type WebsiteDisplaySettings = {
  aiCrawlerEnabled?: boolean;
  isDemo?: boolean;
  logsConfigured?: boolean;
};

export function CrawlerDisplaySettings({
  manage,
  guide = false,
  logsConnected = false,
}: {
  manage: boolean;
  guide?: boolean;
  logsConnected?: boolean;
}) {
  const c = useFeature();
  const action = useAction();
  const client = useQueryClient();
  const query = useData<WebsiteDisplaySettings>(
    'website-display-settings',
    signal => c.api.get(`/liekan/websites/${c.siteId}/settings`, {}, signal),
    !!c.siteId,
    {
      queryKey: ['liekan-feature', c.user.id, 'website-display-settings', c.siteId],
      staleTime: 300000,
    },
  );
  const enabled = query.data?.aiCrawlerEnabled !== false;
  const save = async (next: boolean) => {
    if (!manage) throw new Error('需要网站管理权限。');
    await action.run(
      async () => {
        const result = await c.api.put(`/liekan/websites/${c.siteId}/settings`, {
          aiCrawlerEnabled: next,
        });
        const key = ['liekan-feature', c.user.id, 'website-display-settings', c.siteId];
        await client.cancelQueries({ queryKey: key });
        client.setQueryData(key, result);
        return result;
      },
      next ? 'AI 蜘蛛数据展示已开启' : '已切换为访客统计，可从网站设置重新开启',
    );
  };
  if (guide) {
    if (!query.data || !enabled || logsConnected || query.data.logsConfigured) return null;
    return (
      <Notice>
        <strong>暂不接入 AI 蜘蛛日志？</strong>
        <p>可以仅展示访客统计，隐藏 AI 抓取菜单及总览中的蜘蛛指标。以后可从网站设置重新开启。</p>
        <div className="form-actions">
          <Button disabled={!manage || action.busy || query.isFetching} onClick={() => save(false)}>
            仅展示访客统计
          </Button>
          <LinkButton page="website-settings" params={{ websiteId: c.siteId, section: 'basic' }}>
            查看数据展示设置
          </LinkButton>
        </div>
      </Notice>
    );
  }
  return (
    <Panel title="数据展示" subtitle="按网站选择报表中展示的数据模块。">
      <Body>
        <QueryState query={query}>
          {query.data && (
            <>
              <div className="row spread">
                <div>
                  <strong>AI 蜘蛛数据展示</strong>
                  <p className="muted">
                    {enabled
                      ? '已开启：展示 AI 抓取分析与蜘蛛指标'
                      : '已关闭：总览展示访客指标，隐藏 AI 抓取分析'}
                  </p>
                </div>
                <Button
                  role="switch"
                  aria-label="AI 蜘蛛数据展示"
                  aria-checked={enabled}
                  disabled={!manage || action.busy || query.isFetching}
                  onClick={() => save(!enabled)}
                >
                  {action.busy ? '正在保存…' : enabled ? '关闭展示' : '开启展示'}
                </Button>
              </div>
              <p className="field-help">
                默认开启。关闭展示会保留已有数据和采集配置；日志采集仍按原配置运行。
              </p>
              {!manage && <p className="muted">更改此设置需要网站管理权限。</p>}
              {action.error && <Notice tone="red">{action.error}</Notice>}
            </>
          )}
        </QueryState>
      </Body>
    </Panel>
  );
}
