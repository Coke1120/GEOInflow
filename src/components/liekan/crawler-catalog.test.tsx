import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { AiBots } from './pages/AiBots';
import { ReportContext } from './ReportContext';
import { LiekanLocaleContext } from '@/lib/liekan/i18n/client';
import type { LiekanReport } from './types';

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
      { name: 'GPTBot', botId: 'gptbot', type: '训练', requests: 9 },
      { name: 'GPTBot', botId: null, type: '搜索', requests: 3 },
    ],
  },
  meta: {
    demo: false,
    canManage: true,
    latestImportAt: null,
    ruleCount: 53,
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
      screen.getByRole('button', { name: locale === 'zh-CN' ? '其他已知' : 'Other known' }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: locale === 'zh-CN' ? '用户触发' : 'User-triggered' }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', {
        name: locale === 'zh-CN' ? '所选期间抓取' : 'Crawls in selected period',
      }),
    ).toBeVisible();
    const rows = screen.getAllByRole('button', { name: 'GPTBot' });
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
