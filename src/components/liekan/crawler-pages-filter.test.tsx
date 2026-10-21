import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AiPages } from './pages/AiPages';
import { ReportContext } from './ReportContext';
import type { LiekanReport } from './types';
import { parseReportQuery } from '@/lib/liekan/contracts/query';
import { pageReportQuery } from '@/lib/liekan/upstream/page-report-client';
import { selectRows, tableCsv } from './data';

const report: LiekanReport = {
  contractVersion: 2,
  website: { id: 'site', name: 'Fixture', domain: 'example.com' },
  range: { startAt: 0, endAt: 1, timezone: 'UTC' },
  states: { human: 'empty', logs: 'available', catalog: 'not_connected', goals: 'not_connected' },
  cards: [],
  charts: {},
  tables: {},
  insights: [],
  meta: {
    demo: false,
    canManage: false,
    latestImportAt: null,
    ruleCount: 0,
    crawlerPageBots: [
      { botId: 'gptbot', name: 'GPTBot', type: '训练' },
      { botId: 'gptbot', name: 'GPTBot', type: '其他' },
      { botId: null, name: 'GPTBot', type: '训练' },
      { botId: 'oai-searchbot', name: 'OAI-SearchBot', type: '搜索' },
    ],
  },
};
const actions = {
  filter: '按蜘蛛数',
  query: '',
  sort: { label: '', direction: -1 },
  period: '30 天',
  onFilter: vi.fn(),
  onSort: vi.fn(),
  onAction: vi.fn(),
};

describe('crawler page filters', () => {
  it('places the residual category last and clears purpose, form and identity together', () => {
    const onChange = vi.fn();
    render(
      <ReportContext.Provider
        value={{
          ...actions,
          crawlers: {
            conditions: { botProductForm: 'personal_agent', botId: 'chatgpt-agent' },
            onChange,
          },
        }}
      >
        <AiPages report={report} rangeLabel="7 天" />
      </ReportContext.Provider>,
    );
    const group = screen.getByRole('group', { name: '爬虫类型' });
    expect(
      within(group)
        .getAllByRole('button')
        .map(button => button.textContent),
    ).toEqual([
      '全部',
      'AI 训练',
      'AI 搜索',
      '用户触发',
      '传统搜索',
      'AI 工作台',
      '个人 Agent',
      '其他爬虫',
    ]);
    fireEvent.click(within(group).getByRole('button', { name: '其他爬虫' }));
    expect(onChange).toHaveBeenLastCalledWith({ botCategory: 'other' });
  });

  it('isolates residual filters and excludes all six named categories from displayed exports', () => {
    for (const resource of ['ai/bots', 'ai/pages'] as const) {
      const input = { resource, startAt: 0, endAt: 1, timezone: 'UTC', botCategory: 'other' };
      expect(parseReportQuery(input)).toMatchObject({
        success: true,
        data: { botCategory: 'other' },
      });
      expect(parseReportQuery({ ...input, botProductForm: 'personal_agent' }).success).toBe(false);
      expect(parseReportQuery({ ...input, botCategory: 'invented' }).success).toBe(false);
      expect(pageReportQuery('u', 's', input as any).queryKey).not.toEqual(
        pageReportQuery('u', 's', { ...input, botCategory: undefined } as any).queryKey,
      );
    }
    const rows = [
      ...['训练', '搜索', '用户触发', '传统搜索'].map(type => ({
        name: type,
        type,
        productForm: 'unknown',
      })),
      { name: 'Agent', type: '其他', productForm: 'personal_agent' },
      { name: 'Workbench', type: '其他', productForm: 'workbench' },
      { name: 'Other', type: '其他', productForm: 'unknown' },
    ];
    expect(selectRows(rows, '其他爬虫', { label: '', direction: 1 }, 'botBody')).toEqual([
      rows.at(-1),
    ]);
  });

  it('filters product forms independently and clears the previous type and identity', () => {
    const onChange = vi.fn();
    render(
      <ReportContext.Provider
        value={{
          ...actions,
          crawlers: {
            conditions: { botType: '训练', botId: 'gptbot' },
            onChange,
          },
        }}
      >
        <AiPages report={report} rangeLabel="7 天" />
      </ReportContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'AI 工作台' }));
    expect(onChange).toHaveBeenLastCalledWith({ botProductForm: 'workbench' });
    fireEvent.click(screen.getByRole('button', { name: '个人 Agent' }));
    expect(onChange).toHaveBeenLastCalledWith({ botProductForm: 'personal_agent' });
  });

  it('validates product forms and gives each form its own cache entry on both pages', () => {
    for (const resource of ['ai/bots', 'ai/pages'] as const) {
      const input = { resource, startAt: 0, endAt: 1, timezone: 'UTC' };
      expect(parseReportQuery({ ...input, botProductForm: 'invented' }).success).toBe(false);
      const keys = [undefined, 'workbench', 'personal_agent'].map(botProductForm =>
        JSON.stringify(
          pageReportQuery('user', 'site', { ...input, botProductForm } as any).queryKey,
        ),
      );
      expect(new Set(keys).size).toBe(3);
    }
  });

  it('keeps purpose and product-form labels together in filtered CSV exports', () => {
    const rows = [
      { name: 'Agent', type: '用户触发', productForm: 'personal_agent', requests: 4 },
      { name: 'Workbench', type: '搜索', productForm: 'workbench', requests: 6 },
      { name: 'Unknown', type: '其他', productForm: 'unknown', requests: 2 },
    ];
    expect(selectRows(rows, '个人 Agent', { label: '', direction: 1 }, 'botBody')).toEqual([
      rows[0],
    ]);
    const csv = tableCsv('botBody', rows, 'AI 工作台', { label: '', direction: 1 });
    expect(csv).toContain('AI 搜索 · AI 工作台');
    expect(csv).not.toContain('Agent');
    expect(selectRows(rows, '全部', { label: '', direction: 1 }, 'botBody')).toHaveLength(3);
  });
  it('shows catalog titles, numeric heat, two separate crawler names and a new-tab page link', () => {
    const row = {
      path: '/article',
      title: '标题 <script>demo</script>',
      requests: 12,
      bots: 3,
      heat: 75.5,
      bot: 'GPTBot',
      botId: 'gptbot',
      bot2: 'ClaudeBot',
      bot2Id: null,
      lastCrawled: '2026-10-01T00:00:00Z',
      freshness: null,
    };
    const { container } = render(
      <AiPages
        report={{
          ...report,
          tables: { apBody: [row, { ...row, path: '/missing', title: null, bot2: null }] },
        }}
        rangeLabel="7 天"
      />,
    );
    const table = container.querySelector('#apBody').closest('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map(h => h.textContent),
    ).toEqual([
      '页面',
      '标题',
      '抓取次数',
      '蜘蛛种类',
      '抓取热度',
      '主力蜘蛛',
      '最近抓取',
      '内容新鲜度',
    ]);
    const cells = within(table).getAllByRole('row')[1].querySelectorAll('td');
    expect(cells[1]).toHaveTextContent(row.title);
    expect(cells[1].querySelector('script')).toBeNull();
    expect(cells[4]).toHaveTextContent('75.5');
    expect(cells[4].querySelector('.prog')).toBeNull();
    expect(
      [...cells[5].querySelectorAll('.crawler-page-leaders > span')].map(n => n.textContent),
    ).toEqual(['GPTBot', 'ClaudeBot']);
    expect(cells[5].querySelector('span[title]')).toHaveAttribute('title', 'GPTBot / 官方身份');
    const link = within(cells[0]).getByRole('link');
    expect(link).toHaveAttribute('href', 'https://example.com/article');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(table).getByText('未提供')).toBeInTheDocument();
    expect(selectRows([row], '全部', { label: '', direction: 1 }, 'apBody', row.title)).toEqual([
      row,
    ]);
    const csv = tableCsv('apBody', [row], '全部', { label: '', direction: 1 });
    expect(csv).toContain('"页面","标题","抓取次数"');
    expect(csv).toContain(row.title);
    expect(csv).toContain('GPTBot / 官方身份\nClaudeBot / 自定义／历史未映射');
  });
  it('renders controls before the first report arrives', () => {
    render(<AiPages rangeLabel="7 天" />);
    expect(screen.getByRole('combobox', { name: '具体爬虫' })).toHaveValue('');
    expect(screen.getByRole('button', { name: '全部' })).toHaveAttribute('aria-pressed', 'true');
  });
  it('separates official and custom identities while retaining the selected sort', () => {
    const onChange = vi.fn();
    render(
      <ReportContext.Provider value={{ ...actions, crawlers: { conditions: {}, onChange } }}>
        <AiPages report={report} rangeLabel="7 天" />
      </ReportContext.Provider>,
    );
    const select = screen.getByRole('combobox', { name: '具体爬虫' });
    expect(within(select).getAllByRole('option')).toHaveLength(4);
    fireEvent.change(select, { target: { value: JSON.stringify(['gptbot', 'GPTBot']) } });
    expect(onChange).toHaveBeenLastCalledWith({
      botType: undefined,
      botId: 'gptbot',
      botName: undefined,
    });
    fireEvent.change(select, { target: { value: JSON.stringify([null, 'GPTBot']) } });
    expect(onChange).toHaveBeenLastCalledWith({
      botType: undefined,
      botId: undefined,
      botName: 'GPTBot',
    });
    expect(screen.getByRole('button', { name: '按蜘蛛数' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('limits bot choices to the selected type and clears identity on type changes', () => {
    const onChange = vi.fn();
    render(
      <ReportContext.Provider
        value={{
          ...actions,
          crawlers: { conditions: { botType: '训练', botId: 'gptbot' }, onChange },
        }}
      >
        <AiPages report={report} rangeLabel="7 天" />
      </ReportContext.Provider>,
    );
    expect(screen.queryByRole('option', { name: /OAI-SearchBot/ })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue(JSON.stringify(['gptbot', 'GPTBot']));
    fireEvent.click(screen.getByRole('button', { name: 'AI 搜索' }));
    expect(onChange).toHaveBeenCalledWith({ botType: '搜索' });
    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    expect(onChange).toHaveBeenLastCalledWith({ botType: undefined });
  });

  it('keeps an absent selected crawler visible so an empty result can be cleared', () => {
    render(
      <ReportContext.Provider
        value={{
          ...actions,
          crawlers: { conditions: { botName: 'Absent crawler' }, onChange: vi.fn() },
        }}
      >
        <AiPages report={report} rangeLabel="7 天" />
      </ReportContext.Provider>,
    );
    expect(screen.getByRole('combobox')).toHaveValue(JSON.stringify([null, 'Absent crawler']));
    expect(screen.getByRole('option', { name: 'Absent crawler' })).toBeInTheDocument();
  });

  it('validates filters and isolates cached pages by both type and crawler identity', () => {
    const input = { resource: 'ai/pages' as const, startAt: 0, endAt: 1, timezone: 'UTC' };
    expect(parseReportQuery({ ...input, botType: 'invalid' }).success).toBe(false);
    expect(parseReportQuery({ ...input, botId: 'invalid /id' }).success).toBe(false);
    const key = (filter: Record<string, any>) =>
      pageReportQuery('user', 'site', { ...input, ...filter }).queryKey;
    expect(
      new Set(
        [
          key({}),
          key({ botType: '训练' }),
          key({ botId: 'gptbot' }),
          key({ botName: 'GPTBot' }),
        ].map(value => JSON.stringify(value)),
      ).size,
    ).toBe(4);
  });
});
