import { renderToStaticMarkup } from 'react-dom/server';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { HumanKeywords } from './HumanKeywords';
import type { LiekanReport } from '../types';
import { ReportContext } from '../ReportContext';
import { keywordConditionsSchema } from '@/lib/liekan/contracts/keywords';

vi.mock('../KeywordExport', () => ({ KeywordExport: () => <button>导出全部筛选结果</button> }));
it('clears an unsubmitted query when resetting already-default filters', () => {
  const onChange = vi.fn();
  const defaults = {
    filter: '',
    query: '',
    sort: { label: '', direction: -1 },
    period: '30 天',
    onFilter() {},
    onSort() {},
    onAction() {},
  };
  const report = { cards: [], tables: { keywordBody: [] }, meta: {} } as unknown as LiekanReport;
  render(
    <ReportContext.Provider
      value={{
        ...defaults,
        keywords: {
          conditions: keywordConditionsSchema.parse({}),
          busy: false,
          onChange,
          onPage: vi.fn(),
        },
      }}
    >
      <HumanKeywords report={report} rangeLabel="验收范围" />
    </ReportContext.Provider>,
  );
  const input = screen.getByRole('textbox', { name: '关键词查询' });
  fireEvent.change(input, { target: { value: '未提交的查询' } });
  expect(input).toHaveValue('未提交的查询');
  fireEvent.click(screen.getByRole('button', { name: '重置筛选' }));
  expect(onChange).toHaveBeenLastCalledWith(keywordConditionsSchema.parse({}));
  expect(input).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: '查询' }));
  expect(onChange).toHaveBeenLastCalledWith({ search: '' });
});
it('renders keyword evidence as text and distinguishes unavailable conversion metrics', () => {
  const report = {
    cards: [],
    tables: {
      keywordBody: [
        {
          id: 'one',
          keyword: '<script>window.injected=true</script>',
          engine: 'Google',
          evidence: 'referrer',
          status: 'available',
          sessions: 1,
          share: 100,
          bounceRate: 100,
          conversionRate: null,
        },
      ],
    },
    meta: {
      keywordHasGoals: false,
      tablePages: { keywordBody: { page: 1, pageSize: 20, total: 1 } },
    },
  } as unknown as LiekanReport;
  const html = renderToStaticMarkup(<HumanKeywords report={report} rangeLabel="验收范围" />);
  const container = document.createElement('div');
  container.innerHTML = html;
  expect(container.querySelector('script')).toBeNull();
  expect(container.querySelector('tbody td')).toHaveTextContent(
    '<script>window.injected=true</script>',
  );
  expect(container.querySelectorAll('thead th')).toHaveLength(7);
  expect(container.querySelector('tbody td:last-child')).toHaveTextContent('–');
  expect(html).toContain('尚未配置转化目标');
  expect(html).toContain('未提供的关键词会保留在统计中');
});
