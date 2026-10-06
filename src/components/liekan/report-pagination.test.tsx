import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { tableCsv } from './data';
import { ReportList, ReportRows } from './ReportComponents';
import { ReportContext } from './ReportContext';
import type { LiekanReport, Row } from './types';

const baseActions = {
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
      logs: 'available',
      catalog: 'available',
      goals: 'not_connected',
    },
    cards: [],
    charts: {},
    tables: {},
    insights: [],
    meta: { demo: false, canManage: true, latestImportAt: null, ruleCount: 0 },
  };
}

function rows(count: number, prefix: string): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    path: `${prefix}-${i + 1}`,
    pv: count - i,
  }));
}

function renderTable(table: string, data: LiekanReport, actions = baseActions) {
  return render(
    <ReportContext.Provider value={actions}>
      <table>
        <ReportRows table={table} report={data} pageSize={20} />
      </table>
    </ReportContext.Provider>,
  );
}

const click = async (button: HTMLElement) => {
  await act(async () => {
    fireEvent.click(button);
  });
};

describe('report detail table pagination', () => {
  it('pages rows beyond 20 with total and page position', async () => {
    const data = report();
    data.tables.topBody = rows(25, '/page');
    renderTable('topBody', data);
    expect(screen.getByText('共 25 条')).toBeInTheDocument();
    expect(screen.getByText('第 1 / 2 页')).toBeInTheDocument();
    expect(screen.getByText('/page-1')).toBeInTheDocument();
    expect(screen.getByText('/page-20')).toBeInTheDocument();
    expect(screen.queryByText('/page-21')).not.toBeInTheDocument();
    await click(screen.getByRole('button', { name: '下一页' }));
    expect(screen.getByText('第 2 / 2 页')).toBeInTheDocument();
    expect(screen.getByText('/page-25')).toBeInTheDocument();
    expect(screen.queryByText('/page-20')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled();
    await click(screen.getByRole('button', { name: '上一页' }));
    expect(screen.getByText('第 1 / 2 页')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled();
  });

  it('keeps tables of 20 rows or fewer pager-free', () => {
    const data = report();
    data.tables.topBody = rows(20, '/page');
    renderTable('topBody', data);
    expect(screen.queryByText(/共 \d+ 条/)).not.toBeInTheDocument();
    expect(screen.getByText('/page-20')).toBeInTheDocument();
  });

  it('returns to the first page when filter or query changes', async () => {
    const data = report();
    data.tables.topBody = rows(25, '/page');
    const view = renderTable('topBody', data);
    await click(screen.getByRole('button', { name: '下一页' }));
    expect(screen.getByText('/page-21')).toBeInTheDocument();
    view.rerender(
      <ReportContext.Provider value={{ ...baseActions, filter: '按 PV' }}>
        <table>
          <ReportRows table="topBody" report={data} pageSize={20} />
        </table>
      </ReportContext.Provider>,
    );
    expect(screen.getByText('第 1 / 2 页')).toBeInTheDocument();
    expect(screen.queryByText('/page-21')).not.toBeInTheDocument();
    await click(screen.getByRole('button', { name: '下一页' }));
    expect(screen.getByText('/page-21')).toBeInTheDocument();
    view.rerender(
      <ReportContext.Provider value={{ ...baseActions, query: 'page-1' }}>
        <table>
          <ReportRows table="topBody" report={data} pageSize={20} />
        </table>
      </ReportContext.Provider>,
    );
    expect(screen.queryByText(/共 \d+ 条/)).not.toBeInTheDocument();
    expect(screen.getByText('/page-1')).toBeInTheDocument();
  });

  it('pages the AI blind-spot list the same way', async () => {
    const data = report();
    data.tables.blindList = rows(45, '/blind');
    render(
      <ReportContext.Provider value={baseActions}>
        <ReportList id="blindList" className="" report={data} pageSize={20} />
      </ReportContext.Provider>,
    );
    expect(screen.getByText('共 45 条')).toBeInTheDocument();
    expect(screen.getByText('第 1 / 3 页')).toBeInTheDocument();
    await click(screen.getByRole('button', { name: '下一页' }));
    expect(screen.getByText('/blind-21')).toBeInTheDocument();
    expect(screen.queryByText('/blind-20')).not.toBeInTheDocument();
  });

  it('pages the spider preference list beyond its former display cap', async () => {
    const data = report();
    data.tables.prefList = Array.from({ length: 28 }, (_, i) => ({
      bot: `GPTBot-${i + 1}`,
      preference: '技术文档',
    }));
    render(
      <ReportContext.Provider value={baseActions}>
        <ReportList id="prefList" className="" report={data} pageSize={20} />
      </ReportContext.Provider>,
    );
    expect(screen.getByText('共 28 条')).toBeInTheDocument();
    expect(screen.getByText('第 1 / 2 页')).toBeInTheDocument();
    expect(screen.getByText('GPTBot-20')).toBeInTheDocument();
    expect(screen.queryByText('GPTBot-21')).not.toBeInTheDocument();
    await click(screen.getByRole('button', { name: '下一页' }));
    expect(screen.getByText('GPTBot-21')).toBeInTheDocument();
    expect(screen.queryByText('GPTBot-20')).not.toBeInTheDocument();
  });

  it('pages the robots policy list when more than 20 rules are stored', async () => {
    const data = report();
    data.tables.robotsList = Array.from({ length: 23 }, (_, i) => ({
      bot: `Spider-${i + 1}`,
      policy: '已保存本地策略',
    }));
    render(
      <ReportContext.Provider value={baseActions}>
        <ReportList id="robotsList" className="" report={data} pageSize={20} />
      </ReportContext.Provider>,
    );
    expect(screen.getByText('共 23 条')).toBeInTheDocument();
    await click(screen.getByRole('button', { name: '下一页' }));
    expect(screen.getByText('Spider-21')).toBeInTheDocument();
    expect(screen.getByText('第 2 / 2 页')).toBeInTheDocument();
  });

  it('exports every filtered row instead of the display limit', () => {
    const data = rows(25, '/page').map(row => ({ ...row, source: String(row.path) }));
    const csv = tableCsv('srcBody', data, '', { label: '', direction: -1 });
    expect(csv).toContain('"/page-1"');
    expect(csv).toContain('"/page-25"');
    expect(csv.match(/"\/page-\d+"/g)).toHaveLength(25);
  });
});

describe('log page windowed pagination', () => {
  function logsReport(meta: Partial<LiekanReport['meta']>): LiekanReport {
    const data = report();
    data.tables.logBody = rows(100, '/log').map(row => ({ ...row, method: 'GET' }));
    Object.assign(data.meta, meta);
    return data;
  }

  function renderLogs(
    data: LiekanReport,
    onLogsPage: (page: number) => void,
    actions = baseActions,
  ) {
    return render(
      <ReportContext.Provider value={{ ...actions, onLogsPage }}>
        <table>
          <ReportRows table="logBody" report={data} pageSize={20} />
        </table>
      </ReportContext.Provider>,
    );
  }

  it('slices the server batch into 20-row windows and pages locally', async () => {
    const onLogsPage = vi.fn();
    const data = logsReport({ totalLogs: 220, page: 1, pageSize: 100, nextCursor: 'c2' });
    const view = renderLogs(data, onLogsPage);
    expect(screen.getByText('共 220 条')).toBeInTheDocument();
    expect(screen.getByText('第 1 / 11 页')).toBeInTheDocument();
    expect(screen.queryByText('GET /log-21')).not.toBeInTheDocument();
    await click(screen.getByRole('button', { name: '下一页' }));
    expect(screen.getByText('第 2 / 11 页')).toBeInTheDocument();
    expect(screen.getByText('GET /log-21')).toBeInTheDocument();
    expect(onLogsPage).not.toHaveBeenCalled();
    const refreshed = logsReport({ totalLogs: 220, page: 1, pageSize: 100, nextCursor: 'c2' });
    view.rerender(
      <ReportContext.Provider value={{ ...baseActions, onLogsPage }}>
        <table>
          <ReportRows table="logBody" report={refreshed} pageSize={20} />
        </table>
      </ReportContext.Provider>,
    );
    expect(screen.getByText('第 2 / 11 页')).toBeInTheDocument();
    expect(onLogsPage).not.toHaveBeenCalled();
  });

  it('crosses to the next server batch at the batch boundary and lands on its first page', async () => {
    const onLogsPage = vi.fn();
    const data = logsReport({ totalLogs: 220, page: 1, pageSize: 100, nextCursor: 'c2' });
    renderLogs(data, onLogsPage);
    for (let i = 0; i < 5; i += 1) {
      await click(screen.getByRole('button', { name: '下一页' }));
    }
    expect(onLogsPage).toHaveBeenCalledTimes(1);
    expect(onLogsPage).toHaveBeenCalledWith(2);
    expect(screen.getByText('第 6 / 11 页')).toBeInTheDocument();
  });

  it('crosses to the previous server batch at its start and lands on its last page', async () => {
    const onLogsPage = vi.fn();
    const data = logsReport({
      totalLogs: 220,
      page: 2,
      pageSize: 100,
      nextCursor: 'c3',
      previousCursor: 'c1',
    });
    renderLogs(data, onLogsPage);
    expect(screen.getByText('第 6 / 11 页')).toBeInTheDocument();
    await click(screen.getByRole('button', { name: '上一页' }));
    expect(onLogsPage).toHaveBeenCalledTimes(1);
    expect(onLogsPage).toHaveBeenCalledWith(1);
    expect(screen.getByText('第 5 / 11 页')).toBeInTheDocument();
  });

  it('disables next at the last global page derived from totalLogs', async () => {
    const onLogsPage = vi.fn();
    const data = logsReport({
      totalLogs: 220,
      page: 2,
      pageSize: 100,
      nextCursor: 'c3',
      previousCursor: 'c1',
    });
    renderLogs(data, onLogsPage);
    for (let i = 0; i < 5; i += 1) {
      await click(screen.getByRole('button', { name: '下一页' }));
    }
    expect(onLogsPage).toHaveBeenCalledWith(3);
    expect(screen.getByText('第 11 / 11 页')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled();
  });

  it('hides the pager when totalLogs fits one page', () => {
    const data = logsReport({ totalLogs: 15, page: 1, pageSize: 100 });
    renderLogs(data, vi.fn());
    expect(screen.queryByText(/共 \d+ 条/)).not.toBeInTheDocument();
    expect(screen.getByText('GET /log-15')).toBeInTheDocument();
  });
});
