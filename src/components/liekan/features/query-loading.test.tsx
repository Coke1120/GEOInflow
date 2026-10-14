import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Chart } from './Chart';
import { Body, Form, MatrixTable, Metrics, Panel, QueryState, StaticHeading, Table } from './ui';

vi.mock('./context', () => ({ useFeature: () => ({ query: {}, updateQuery: vi.fn() }) }));
vi.mock('./listState', () => ({ useListState: () => ['', vi.fn()] }));

describe('module loading', () => {
  it('keeps a nested ready editor behind an outer pending record', () => {
    const save = vi.fn();
    render(
      <QueryState query={{ isPending: true }}>
        <QueryState query={{ isPending: false, data: [] }}>
          <Form onSubmit={save}>
            <input name="name" defaultValue="默认值" />
          </Form>
        </QueryState>
      </QueryState>,
    );
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(save).not.toHaveBeenCalled();
  });
  it('keeps retention columns and withholds a data-dependent empty-state heading', () => {
    const view = render(
      <QueryState query={{ isPending: true }}>
        <div>
          <MatrixTable headings={['入组日期 / 人数', '第 1 天', '第 7 天']}>
            <tbody />
          </MatrixTable>
          <div className="state-box">
            <h3>尚未采集可预览的数据</h3>
          </div>
          <StaticHeading>固定的网站</StaticHeading>
        </div>
      </QueryState>,
    );
    expect(screen.getByRole('columnheader', { name: '第 7 天' })).toBeInTheDocument();
    expect(view.container.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(view.container.querySelectorAll('tbody td')).toHaveLength(9);
    expect(screen.queryByText('尚未采集可预览的数据')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '固定的网站' })).toBeInTheDocument();
  });
  it('preserves chart dimensions, labels and table headers without drawing missing values', () => {
    const view = render(
      <QueryState query={{ isPending: true }}>
        <div className="two">
          <Chart interactionKey="loading-fixture" title="访问趋势" height={260} />
          <Panel title="来源明细">
            <Table columns={['来源', '访客']} rows={[]} />
          </Panel>
        </div>
        <Metrics items={[['访客', '0', '尚未读取']]} />
      </QueryState>,
    );
    expect(screen.getByRole('heading', { name: '访问趋势' })).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveStyle({ height: '260px' });
    expect(screen.getByRole('heading', { name: '来源明细' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /来源/ })).toBeInTheDocument();
    expect(screen.queryByText('当前范围没有数据')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText('尚未读取')).not.toBeInTheDocument();
    expect(view.container.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(screen.getByRole('button', { name: /来源/ })).toBeDisabled();
  });
  it('keeps cached rows through background refresh and transient failure, and hides forbidden rows', () => {
    const table = <Table columns={['来源']} rows={[['真实来源']]} />;
    const view = render(<QueryState query={{ isPending: true, data: [] }}>{table}</QueryState>);
    expect(screen.getByText('真实来源')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    view.rerender(
      <QueryState query={{ data: [], error: { status: 500 }, refetch: vi.fn() }}>
        {table}
      </QueryState>,
    );
    expect(screen.getByText('真实来源')).toBeInTheDocument();
    expect(screen.getByText(/更新失败/)).toBeInTheDocument();
    view.rerender(<QueryState query={{ data: [], error: { status: 403 } }}>{table}</QueryState>);
    expect(screen.queryByText('真实来源')).not.toBeInTheDocument();
    expect(screen.getByText('没有访问权限')).toBeInTheDocument();
  });
  it('withholds editable forms until their saved values arrive', () => {
    const save = vi.fn();
    render(
      <QueryState query={{ isPending: true }}>
        <Panel title="采集设置">
          <Body>
            <Form onSubmit={save}>
              <input name="name" defaultValue="" />
            </Form>
          </Body>
        </Panel>
      </QueryState>,
    );
    expect(screen.getByRole('heading', { name: '采集设置' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });
  it('fills values when ready, including genuine zeros and empty rows', () => {
    const content = (
      <>
        <Metrics items={[['访客', 0]]} />
        <Table columns={['来源']} rows={[]} />
      </>
    );
    const view = render(<QueryState query={{ isPending: true }}>{content}</QueryState>);
    view.rerender(<QueryState query={{ isPending: false, data: [] }}>{content}</QueryState>);
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('当前范围没有数据')).toBeInTheDocument();
    expect(view.container.querySelector('[aria-busy="true"]')).toBeNull();
  });
  it('renders a loading region for conditional content without invoking an editor', () => {
    const editor = vi.fn(() => <input />);
    const Editor = editor;
    render(<QueryState query={{ isPending: true }}>{false && <Editor />}</QueryState>);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(editor).not.toHaveBeenCalled();
  });
  it('preserves unsaved editor state when a cached request fails and then recovers', () => {
    function Editor() {
      const [value, setValue] = useState('已保存');
      return <input value={value} onChange={event => setValue(event.target.value)} />;
    }
    const view = render(
      <QueryState query={{ data: {} }}>
        <Editor />
      </QueryState>,
    );
    const editor = screen.getByRole('textbox');
    fireEvent.change(editor, { target: { value: '尚未保存的修改' } });
    view.rerender(
      <QueryState query={{ data: {}, error: { status: 500 } }}>
        <Editor />
      </QueryState>,
    );
    expect(screen.getByRole('textbox')).toBe(editor);
    expect(editor).toHaveValue('尚未保存的修改');
    view.rerender(
      <QueryState query={{ data: {} }}>
        <Editor />
      </QueryState>,
    );
    expect(screen.getByRole('textbox')).toBe(editor);
    expect(editor).toHaveValue('尚未保存的修改');
    expect(screen.queryByText(/更新失败/)).not.toBeInTheDocument();
  });
});
