import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QueryState, Table } from './ui';

describe('read-only query presentation', () => {
  const data = { name: '当前范围结果' };
  const content = <div data-test="result">当前范围结果</div>;
  it('keeps current results mounted during refresh and transient failure', () => {
    const { rerender } = render(
      <QueryState readOnly query={{ data, isFetching: false }}>
        {content}
      </QueryState>,
    );
    const node = screen.getByTestId('result');
    rerender(
      <QueryState readOnly query={{ data, isFetching: true }}>
        {content}
      </QueryState>,
    );
    expect(screen.getByTestId('result')).toBe(node);
    rerender(
      <QueryState readOnly query={{ data, error: { status: 503 }, dataUpdatedAt: 1 }}>
        {content}
      </QueryState>,
    );
    expect(screen.getByTestId('result')).toBe(node);
    expect(screen.getByText(/更新失败，显示上次结果/)).toBeInTheDocument();
  });
  it.each([401, 403, 404])('hides old results on status %i', status => {
    render(
      <QueryState readOnly query={{ data, error: { status }, refetch: vi.fn() }}>
        {content}
      </QueryState>,
    );
    expect(screen.queryByTestId('result')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
  it('keeps the existing form error behavior', () => {
    render(<QueryState query={{ data, error: { status: 503 } }}>{content}</QueryState>);
    expect(screen.queryByTestId('result')).not.toBeInTheDocument();
    expect(screen.getByText('读取失败')).toBeInTheDocument();
  });
  it('preserves a requested page while its result is pending', () => {
    const onPage = vi.fn();
    const { rerender } = render(
      <QueryState readOnly query={{ isPending: true }}>
        <Table columns={['页面']} rows={[]} page={2} pages={1} onPage={onPage} />
      </QueryState>,
    );
    expect(onPage).not.toHaveBeenCalled();
    rerender(
      <QueryState readOnly query={{ data: [] }}>
        <Table columns={['页面']} rows={[]} page={2} pages={1} onPage={onPage} />
      </QueryState>,
    );
    expect(onPage).toHaveBeenCalledWith(1);
  });
  it('shows real table headers with loading rows and no empty-data message', () => {
    render(
      <QueryState readOnly query={{ isPending: true }}>
        <Table columns={['页面', '访客']} rows={[]} />
      </QueryState>,
    );
    expect(screen.getByRole('columnheader', { name: /页面/ })).toBeInTheDocument();
    expect(screen.queryByText('当前范围没有数据')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('正在读取当前范围的数据');
  });
});
