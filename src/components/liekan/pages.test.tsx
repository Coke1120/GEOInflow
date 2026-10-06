import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AiOverview } from './pages/AiOverview';
import { Overview } from './pages/Overview';
import { Content } from './pages/Content';
import { tableCsv } from './data';
import { AiPreference } from './pages/AiPreference';
import { Conversions } from './pages/Conversions';
import { HumanGeo } from './pages/HumanGeo';
import { HumanSources } from './pages/HumanSources';
import { ReportContext } from './ReportContext';
import type { LiekanReport } from './types';

const actions = {
  filter: '',
  query: '',
  sort: { label: '', direction: -1 },
  period: '30 天',
  onFilter() {},
  onSort() {},
  onAction() {},
};
function report(): LiekanReport {
  return {
    contractVersion: 2,
    website: { id: 'site', name: '站点', domain: 'example.test' },
    range: { startAt: 1, endAt: 2, timezone: 'Asia/Shanghai' },
    states: {
      human: 'available',
      logs: 'not_connected',
      catalog: 'not_connected',
      goals: 'not_connected',
    },
    cards: [],
    charts: {},
    tables: {},
    insights: [],
    meta: { demo: false, canManage: true, latestImportAt: null, ruleCount: 0 },
  };
}
describe('evidence-backed reference copy', () => {
  it('renders visitor statistics and exports visitor columns when crawler display is off', () => {
    const data = report();
    data.meta.aiCrawlerEnabled = false;
    data.tables.visitorTopBody = [{ path: '/welcome', pv: 25, uv: 10 }];
    data.tables.visitorPgBody = [{ path: '/welcome', pv: 25, uv: 10 }];
    const html = renderToStaticMarkup(
      <ReportContext.Provider value={actions}>
        <Overview report={data} rangeLabel="范围" />
        <Content report={data} rangeLabel="范围" />
      </ReportContext.Provider>,
    );
    expect(html).toContain('访客浏览趋势');
    expect(html).toContain('浏览量 PV');
    expect(html).toContain('/welcome');
    expect(html).not.toMatch(/AI 蜘蛛|AI 抓取|GEO 评价|最活跃蜘蛛/);
    const csv = tableCsv('visitorTopBody', data.tables.visitorTopBody, '', {
      label: '浏览量 PV',
      direction: -1,
    });
    expect(csv).toContain('浏览量 PV');
    expect(csv).toContain('25');
    expect(csv).not.toMatch(/AI|蜘蛛|抓取/);
  });
  it('uses observed AI referral sessions and weighted bounce rate without source sample claims', () => {
    const data = report();
    data.tables.srcBody = [
      { source: 'chatgpt.com', channel: 'AI 搜索引荐', sessions: 2, bounceRate: 25 },
      { source: 'perplexity.ai', channel: 'AI 搜索引荐', sessions: 8, bounceRate: 75 },
    ];
    data.cards = [
      { key: 'conversion', label: 'AI 引荐转化率', value: 2.6, unit: '%', state: 'available' },
    ];
    const html = renderToStaticMarkup(
      <ReportContext.Provider value={actions}>
        <HumanSources report={data} rangeLabel="真实范围" />
      </ReportContext.Provider>,
    );
    expect(html).toContain('10 次 AI 引荐会话；跳出率 65%，转化率 2.6%');
    expect(html).not.toContain('24%');
    expect(html).not.toContain('4.2%');
    expect(html).not.toContain('被引用得多');
    expect(html).toContain('会话首个 Referer');
  });
  it('distinguishes an unconnected referral source from an empty range', () => {
    const data = report();
    data.states.human = 'not_connected';
    const html = renderToStaticMarkup(
      <ReportContext.Provider value={actions}>
        <HumanSources report={data} rangeLabel="范围" />
      </ReportContext.Provider>,
    );
    expect(html).toContain('引荐数据待接入');
    expect(html).not.toContain('当前范围暂无可识别');
  });
  it('shows configured funnel labels and the unconfigured state at the original subtitle', () => {
    const data = report();
    data.charts.f1 = { labels: ['注册页', '表单提交'], series: [] };
    const render = () =>
      renderToStaticMarkup(
        <ReportContext.Provider value={actions}>
          <Conversions report={data} rangeLabel="范围" />
        </ReportContext.Provider>,
      );
    expect(render()).toContain('注册页 → 表单提交');
    data.charts.f1.labels = [];
    expect(render()).toContain('转化漏斗待配置');
    expect(render()).not.toContain('首页 → 产品');
    data.charts.f1.state = 'unsupported';
    expect(render()).toContain('已保存的漏斗配置无效，请检查目标配置');
    expect(render()).not.toContain('转化漏斗待配置');
  });
  it('states the actual local geography data maintenance limitation', () => {
    const html = renderToStaticMarkup(
      <ReportContext.Provider value={actions}>
        <HumanGeo report={report()} rangeLabel="范围" />
      </ReportContext.Provider>,
    );
    expect(html).toContain('本地人工 GeoIP · 更新日期待核验');
    expect(html).not.toContain('每日更新');
  });
  it('keeps AI preference insights in the original single paragraph with its bold prefix', () => {
    const data = report();
    data.insights = ['实际目录覆盖已接入。', '引用结果仍待验证。'];
    const html = renderToStaticMarkup(<AiPreference report={data} rangeLabel="范围" />);
    const container = document.createElement('div');
    container.innerHTML = html;
    const insights = container.querySelector('main > section:last-child');
    expect(insights.children).toHaveLength(1);
    expect(insights.firstElementChild.tagName).toBe('P');
    expect(insights.firstElementChild.className).toBe('text-[12px] text-sub leading-relaxed');
    expect(insights.querySelector('b')).toHaveTextContent('GEO 洞察：');
    expect(insights).toHaveTextContent('实际目录覆盖已接入。 引用结果仍待验证。');
    expect(insights.querySelector('.rounded-full')).toBeNull();
  });
  it('shows the robots policy list five entries per page with a pager', () => {
    const data = report();
    data.states.logs = 'available';
    data.tables.robotsList = Array.from({ length: 8 }, (_, i) => ({
      bot: `Spider-${i + 1}`,
      policy: '未设置',
    }));
    const html = renderToStaticMarkup(
      <ReportContext.Provider value={actions}>
        <AiOverview report={data} rangeLabel="范围" />
      </ReportContext.Provider>,
    );
    expect(html).toContain('Spider-5');
    expect(html).not.toContain('Spider-6');
    expect(html).toContain('共 8 条');
    expect(html).toContain('第 1 / 2 页');
  });
});
