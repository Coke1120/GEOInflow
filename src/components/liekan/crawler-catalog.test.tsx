import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { AiBots } from './pages/AiBots';
import { AiPreference } from './pages/AiPreference';
import { ReportContext } from './ReportContext';
import { ReportList } from './ReportComponents';
import { LiekanLocaleContext } from '@/lib/liekan/i18n/client';
import type { LiekanReport } from './types';

it.each(['zh-CN', 'en-US'] as const)(
  'identifies the custom crawler in the %s crawl sequence caption',
  locale => {
    render(
      <LiekanLocaleContext.Provider value={locale}>
        <AiPreference
          rangeLabel="7 天"
          report={{
            ...report,
            tables: { pathList: [{ bot: 'GPTBot', botId: null, path: '/custom', status: 200 }] },
          }}
        />
      </LiekanLocaleContext.Provider>,
    );
    expect(screen.getByText(/GPTBot/)).toHaveTextContent(
      locale === 'zh-CN' ? '自定义／历史未映射' : 'Custom / historical unmapped',
    );
  },
);

const report: LiekanReport = {
  contractVersion: 2,
  website: { id: 'site', name: 'Site', domain: 'example.test' },
  range: { startAt: 1, endAt: 2, timezone: 'UTC' },
  states: { human: 'available', logs: 'available', catalog: 'available', goals: 'not_connected' },
  cards: [],
  charts: {},
  insights: [],
  tables: {
    botBody: [
      { name: 'GPTBot', vendor: 'OpenAI', botId: 'gptbot', type: '训练', requests: 9 },
      { name: 'GPTBot', vendor: 'OpenAI', botId: null, type: '搜索', requests: 3 },
    ],
  },
  meta: {
    demo: false,
    canManage: true,
    latestImportAt: null,
    ruleCount: 57,
    crawlerClassification: {
      mode: 'mixed',
      versions: 2,
      legacyRequests: 3,
      unclassifiedRequests: 1,
    },
  },
};
it.each(['zh-CN', 'en-US'] as const)(
  'renders all crawler categories, selected-period scope and exact identities in %s',
  locale => {
    const onAction = vi.fn();
    render(
      <LiekanLocaleContext.Provider value={locale}>
        <ReportContext.Provider
          value={{
            filter: '',
            query: '',
            sort: { label: '', direction: -1 },
            period: '7 天',
            onFilter() {},
            onSort() {},
            onAction,
          }}
        >
          <AiBots report={report} rangeLabel="7 天" />
        </ReportContext.Provider>
      </LiekanLocaleContext.Provider>,
    );
    expect(
      screen.getByRole('button', { name: locale === 'zh-CN' ? '其他爬虫' : 'Other crawlers' }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: locale === 'zh-CN' ? '用户触发' : 'User-triggered' }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', {
        name: locale === 'zh-CN' ? 'AI 工作台' : 'AI workbench',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', {
        name: locale === 'zh-CN' ? '个人 Agent' : 'Personal agent',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', {
        name: locale === 'zh-CN' ? '所选期间抓取' : 'Crawls in selected period',
      }),
    ).toBeVisible();
    expect(
      screen.getByText(locale === 'zh-CN' ? 'OpenAI · 官方身份' : 'OpenAI · Official identity'),
    ).toBeVisible();
    expect(
      screen.getByText(
        locale === 'zh-CN'
          ? 'OpenAI · 自定义／历史未映射'
          : 'OpenAI · Custom / historical unmapped',
      ),
    ).toBeVisible();
    const rows = screen.getAllByRole('button', { name: /^GPTBot/ });
    expect(rows[0]).not.toHaveAccessibleName(rows[1].getAttribute('aria-label'));
    fireEvent.click(rows[0]);
    expect(onAction).toHaveBeenLastCalledWith('蜘蛛详情:{"name":"GPTBot","botId":"gptbot"}');
    fireEvent.click(rows[1]);
    expect(onAction).toHaveBeenLastCalledWith('蜘蛛详情:{"name":"GPTBot","botId":null}');
    fireEvent.click(
      screen.getByRole('button', {
        name:
          locale === 'zh-CN'
            ? '查看未知／未分类请求日志'
            : 'View unknown / unclassified request logs',
      }),
    );
    expect(onAction).toHaveBeenLastCalledWith('未知请求日志');
  },
);

it.each(['zh-CN', 'en-US'] as const)(
  'keeps same-name content preferences attached to their identities in %s',
  locale => {
    const { container } = render(
      <LiekanLocaleContext.Provider value={locale}>
        <ReportList
          id="prefList"
          className=""
          report={{
            ...report,
            tables: {
              prefList: [
                { bot: 'GPTBot', botId: 'gptbot', preference: '/cases' },
                { bot: 'GPTBot', botId: null, preference: '/articles' },
                { bot: 'LegacyBot', preference: '/legacy' },
              ],
            },
          }}
        />
      </LiekanLocaleContext.Provider>,
    );
    const rows = container.querySelectorAll('#prefList > div');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent(locale === 'zh-CN' ? '官方身份' : 'Official identity');
    expect(rows[0]).toHaveTextContent('/cases');
    expect(rows[1]).toHaveTextContent(
      locale === 'zh-CN' ? '自定义／历史未映射' : 'Custom / historical unmapped',
    );
    expect(rows[1]).toHaveTextContent('/articles');
    expect(rows[2].textContent).toBe('LegacyBot/legacy');
  },
);
