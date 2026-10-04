import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { FeatureProvider } from './context';
import { Table } from './ui';
it('uses one resource action and keeps disclosure with its resource after sorting', () => {
  const action = vi.fn();
  const updateQuery = vi.fn();
  const rows = [
    [
      '乙',
      '完整乙地址',
      <button key="b" onClick={action}>
        管理乙
      </button>,
    ],
    ['甲', '完整甲地址', <button key="a">管理甲</button>],
  ];
  render(
    <FeatureProvider value={{ query: {}, updateQuery } as any}>
      <Table mobile rowKeys={['b', 'a']} columns={['名称', '地址', '操作']} rows={rows} />
    </FeatureProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: '展开乙的详情' }));
  expect(screen.getByRole('button', { name: '收起乙的详情' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  fireEvent.click(screen.getByRole('button', { name: '名称' }));
  expect(screen.getByRole('button', { name: '收起乙的详情' }).closest('tr')).toHaveTextContent(
    '完整乙地址',
  );
  expect(updateQuery).toHaveBeenCalledWith({ sort: '名称', direction: 'asc' });
  expect(screen.getAllByRole('button', { name: '管理乙' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '管理乙' }));
  expect(action).toHaveBeenCalledOnce();
});
it('keeps a renamed resource expanded and does not expand a different same-name resource', () => {
  const context = { query: {} } as any;
  const row = (name: string) => [[name, '完整地址', '操作']];
  const table = (id: string, name: string) => (
    <FeatureProvider value={context}>
      <Table mobile rowKeys={[id]} columns={['名称', '地址', '操作']} rows={row(name)} />
    </FeatureProvider>
  );
  const view = render(table('a', '相同名称'));
  fireEvent.click(screen.getByRole('button', { name: '展开相同名称的详情' }));
  view.rerender(table('a', '新名称'));
  expect(screen.getByRole('button', { name: '收起新名称的详情' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  view.rerender(table('b', '新名称'));
  expect(screen.getByRole('button', { name: '展开新名称的详情' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});
