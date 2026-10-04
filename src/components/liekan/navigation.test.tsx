import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Navigation } from './Navigation';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  post: vi.fn(),
  clear: vi.fn(),
  clearLogin: vi.fn(),
  pathname: '/websites/site-a/goals/create',
}));
vi.mock('next/link', () => ({
  default: ({ children, prefetch: _prefetch, ...props }: any) => <a {...props}>{children}</a>,
}));
vi.mock('@/lib/liekan/upstream/client', () => ({
  useNavigation: () => ({
    pathname: mocks.pathname,
    query: {},
    router: { push: mocks.push, replace: mocks.replace },
  }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ clear: mocks.clear }),
  useQuery: ({ queryKey }: any) => ({
    isPending: false,
    data: queryKey.includes('navigation-sites')
      ? [
          { id: 'site-a', name: '网站 A', domain: 'a.test' },
          { id: 'site-b', name: '网站 B', domain: 'b.test' },
        ]
      : [],
  }),
}));
vi.mock('@/lib/liekan/upstream/features-client', () => ({
  getFeatureSites: vi.fn(),
  getAllFeatureRows: vi.fn(),
  featureApi: { post: mocks.post },
  clearFeatureLogin: mocks.clearLogin,
}));

describe('website navigation dialog transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pathname = '/websites/site-a/goals/create';
    document.body.style.overflow = '';
  });
  it.each([
    ['boards', '看板'],
    ['board-editor', '看板'],
    ['board-view', '看板'],
    ['board-design', '看板'],
    ['sharing', '分享链接'],
    ['links', '链接'],
    ['link-editor', '链接'],
    ['link-detail', '链接'],
    ['pixels', '像素'],
    ['pixel-editor', '像素'],
    ['pixel-detail', '像素'],
  ])('shows flat global entries with the correct selection for %s', (page, selected) => {
    render(
      <Navigation
        user={{ id: 'user', username: 'admin', isAdmin: true } as any}
        route={{ page }}
        width={228}
        onWidth={vi.fn()}
      />,
    );
    const primary = screen.getByRole('navigation', { name: '业务导航' });
    const entries = within(primary).getAllByRole('link');
    expect(entries.map(entry => entry.textContent)).toEqual([
      '工作台',
      '网站管理',
      '看板',
      '分享链接',
      '团队协作',
      '链接',
      '像素',
    ]);
    expect(within(primary).queryAllByRole('button')).toHaveLength(0);
    expect(primary.querySelectorAll('a[aria-current="page"]')).toHaveLength(1);
    expect(within(primary).getByRole('link', { name: selected })).toHaveAttribute(
      'aria-current',
      'page',
    );
    for (const [label, href] of [
      ['看板', '/boards'],
      ['分享链接', '/liekan/sharing'],
      ['链接', '/links'],
      ['像素', '/pixels'],
    ])
      expect(within(primary).getByRole('link', { name: label, exact: true })).toHaveAttribute(
        'href',
        href,
      );
  });
  it('runs logout once while a delayed request is pending', async () => {
    let complete: () => void;
    mocks.post.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          complete = resolve;
        }),
    );
    render(
      <Navigation
        user={{ id: 'user', username: 'admin' } as any}
        route={{ page: 'account' }}
        width={228}
        onWidth={vi.fn()}
      />,
    );
    const logout = screen.getByRole('button', { name: '退出登录' });
    act(() => {
      logout.click();
      logout.click();
    });
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(logout).toBeDisabled();
    expect(mocks.clearLogin).not.toHaveBeenCalled();
    await act(async () => complete());
    expect(mocks.clearLogin).toHaveBeenCalledTimes(1);
    expect(mocks.clear).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith('/login');
  });
  it('closes an unsaved website-switch prompt when history navigation changes the page', async () => {
    const props = {
      user: { id: 'user', username: 'admin' } as any,
      site: { id: 'site-a', name: '网站 A', domain: 'a.test' },
      width: 228,
      onWidth: vi.fn(),
    };
    const view = render(
      <>
        <form data-unsaved="true" />
        <Navigation {...props} route={{ page: 'goal-editor', websiteId: 'site-a' }} />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: /切换网站，当前/ }));
    fireEvent.change(screen.getByRole('combobox', { name: '网站' }), {
      target: { value: 'site-b' },
    });
    fireEvent.click(screen.getByRole('button', { name: '切换网站' }));
    await screen.findByRole('dialog', { name: '当前修改尚未保存' });
    expect(document.body.style.overflow).toBe('hidden');
    mocks.pathname = '/websites/site-a/goals';
    view.rerender(
      <>
        <form data-unsaved="true" />
        <Navigation {...props} route={{ page: 'goals', websiteId: 'site-a' }} />
      </>,
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.body.style.overflow).toBe('');
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it('does not show a previous website domain or owner while the new site loads', () => {
    render(
      <Navigation
        user={{ id: 'user', username: 'admin' } as any}
        route={{ page: 'sessions', websiteId: 'site-b' }}
        site={{ id: 'site-a', name: '网站 A', domain: 'a.test', teamId: 'old-team' }}
        width={228}
        onWidth={vi.fn()}
      />,
    );
    expect(screen.queryByText('a.test')).not.toBeInTheDocument();
    expect(screen.queryByText('团队空间')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回网站列表' })).toHaveAttribute('href', '/websites');
  });
  it('shows one confirmation and restores scrolling after discarding an unsaved edit', async () => {
    render(
      <>
        <form data-unsaved="true">
          <input aria-label="目标名称" />
        </form>
        <Navigation
          user={{ id: 'user', username: 'admin', isAdmin: true } as any}
          route={{ page: 'goal-editor', websiteId: 'site-a' }}
          site={{ id: 'site-a', name: '网站 A', domain: 'a.test' }}
          width={228}
          onWidth={vi.fn()}
        />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: /切换网站，当前/ }));
    fireEvent.change(screen.getByRole('combobox', { name: '网站' }), {
      target: { value: 'site-b' },
    });
    fireEvent.click(screen.getByRole('button', { name: '切换网站' }));
    await screen.findByRole('dialog', { name: '当前修改尚未保存' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(mocks.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '放弃修改并切换' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.body.style.overflow).toBe('');
    expect(mocks.push).toHaveBeenCalledWith('/websites/site-b/goals');
  });
});
