import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SavedSegments } from './SavedSegments';

const mocks = vi.hoisted(() => ({ updateQuery: vi.fn(), data: [] as any[], isAdmin: true }));
vi.mock('next/link', () => ({
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));
vi.mock('./context', () => ({
  useData: () => ({ data: mocks.data, isPending: false }),
  useFeature: () => ({
    siteId: 'site-a',
    user: { id: 'user', isAdmin: mocks.isAdmin },
    site: { id: 'site-a' },
    teams: [],
    updateQuery: mocks.updateQuery,
    href: (page: string) => `/websites/site-a/${page}`,
  }),
}));
describe('saved segment tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.data = [];
    mocks.isAdmin = true;
  });
  it('applies an existing definition to the current analysis and closes the tool', () => {
    mocks.data = [
      {
        id: 'segment-a',
        name: '移动访客',
        parameters: { filters: [{ name: 'device', operator: 'eq', value: 'mobile' }] },
      },
    ];
    const close = vi.fn();
    render(<SavedSegments onClose={close} />);
    expect(screen.getByText('设备 等于 mobile')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '应用' }));
    expect(mocks.updateQuery).toHaveBeenCalledWith({ segment: 'segment-a', cohort: undefined });
    expect(close).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: '管理分群' })).toHaveAttribute(
      'href',
      '/websites/site-a/segments',
    );
  });
  it('shows the empty state and hides creation for readers', () => {
    mocks.isAdmin = false;
    render(<SavedSegments onClose={vi.fn()} />);
    expect(screen.getByText('当前网站没有已保存分群。')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '创建分群' })).toBeNull();
  });
  it('includes session property restrictions and their match logic in condition summaries', () => {
    mocks.data = [
      {
        id: 'segment-a',
        name: '付费移动访客',
        parameters: {
          filters: [
            { name: 'device', operator: 'eq', value: 'mobile' },
            { name: 'browser', operator: 'eq', value: 'Chrome' },
          ],
          sessionPropertyFilters: [{ propertyName: 'plan', operator: 'eq', value: 'pro' }],
          match: 'any',
        },
      },
      {
        id: 'segment-b',
        name: '企业客户',
        parameters: {
          match: 'any',
          filters: [],
          sessionPropertyFilters: [
            { propertyName: 'customer', operator: 'eq', value: 'enterprise' },
            { propertyName: 'plan', operator: 'eq', value: 'paid' },
          ],
        },
      },
    ];
    render(<SavedSegments onClose={vi.fn()} />);
    expect(
      screen.getByText('(设备 等于 mobile 或 浏览器 等于 Chrome) 且 会话属性 · plan 等于 pro'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('会话属性 · customer 等于 enterprise 且 会话属性 · plan 等于 paid'),
    ).toBeInTheDocument();
    expect(screen.queryByText('全部访客')).not.toBeInTheDocument();
  });
});
