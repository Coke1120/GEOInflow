import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnalysisLoading, reportViews } from './AnalysisLoading';
import { pages } from './data';
import { DataLoading } from './DataLoading';
import type { LiekanReport } from './types';

vi.mock('./chartRuntime', () => ({ loadEcharts: vi.fn() }));

const emptyReport: LiekanReport = {
  contractVersion: 1,
  website: { id: 'site', name: '当前网站', domain: 'example.test' },
  range: { startAt: 1, endAt: 2, timezone: 'Asia/Shanghai' },
  states: { human: 'available', logs: 'available', catalog: 'available', goals: 'available' },
  cards: [],
  charts: {},
  tables: {},
  insights: [],
  meta: { demo: false, canManage: false, latestImportAt: null, ruleCount: 0 },
};

describe('fixed report layouts', () => {
  it.each(pages)(
    '$resource shows headings, metric labels and column headings before data',
    ({ resource }) => {
      const view = render(<AnalysisLoading resource={resource} rangeLabel="当前范围" />);
      const headings = Array.from(view.container.querySelectorAll('h2'), el => el.textContent);
      const columns = Array.from(view.container.querySelectorAll('th'), el => el.textContent);
      const labels = Array.from(
        view.container.querySelectorAll('main > section:first-child > div > p:first-child'),
        el => el.textContent,
      );
      const charts = Array.from(
        view.container.querySelectorAll('[role="img"]'),
        el => (el as HTMLElement).style.height,
      );
      if (resource !== 'ai/bots') expect(labels.length).toBeGreaterThanOrEqual(4);
      expect(headings.length).toBeGreaterThan(0);
      expect(screen.getByRole('status')).toHaveTextContent('正在读取统计数据');
      expect(view.container.querySelectorAll('[aria-busy="true"]').length).toBeGreaterThan(0);
      expect(
        view.container.querySelectorAll('main > section:first-child > div > p:nth-child(2)'),
      ).toSatisfy((nodes: NodeListOf<Element>) =>
        Array.from(nodes).every(el => el.textContent === ''),
      );
      expect(view.container.textContent).not.toMatch(
        /数据待接入|暂无数据|转化漏斗待配置|引荐数据待接入|会话未识别/,
      );
      const View = reportViews[resource];
      view.rerender(<View report={emptyReport} rangeLabel="当前范围" />);
      expect(Array.from(view.container.querySelectorAll('h2'), el => el.textContent)).toEqual(
        headings,
      );
      expect(Array.from(view.container.querySelectorAll('th'), el => el.textContent)).toEqual(
        columns,
      );
      expect(
        Array.from(
          view.container.querySelectorAll('main > section:first-child > div > p:first-child'),
          el => el.textContent,
        ),
      ).toEqual(labels);
      expect(
        Array.from(
          view.container.querySelectorAll('[role="img"]'),
          el => (el as HTMLElement).style.height,
        ),
      ).toEqual(charts);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(view.container.querySelector('[aria-busy="true"]')).toBeNull();
    },
  );
  it('announces nested loading only once', () => {
    render(
      <DataLoading loading>
        <AnalysisLoading resource="overview" />
      </DataLoading>,
    );
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });
});
