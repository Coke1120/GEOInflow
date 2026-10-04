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
  useLinkStatus: () => ({ pending: false }),
  default: ({ children, prefetch: _prefetch, ...props }: any) => <a {...props}>{children}</a>,
}));
vi.mock('@/lib/liekan/upstream/client', () => ({
  useFeatureDateRange: () => ({ dateRange: { startDate: new Date(0), endDate: new Date(1000) } }),
  useNavigation: () => ({
    pathname: mocks.pathname,
    query: {},
    router: { push: mocks.push, replace: mocks.replace },
  }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    clear: mocks.clear,
    prefetchQuery: vi.fn().mockResolvedValue(undefined),
  }),
  useQuery: ({ queryKey }: any) => ({
    isPending: false,
    data: queryKey.includes('sites')
      ? [
          { id: 'site-a', name: '网站 A', domain: 'a.test' },
          { id: 'site-b', name: '网站 B', domain: 'b.test' },
        ]
      : [],
  }),
}));
vi.mock('@/lib/liekan/upstream/features-client', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/liekan/upstream/features-client')>()),
  getFeatureSites: vi.fn(),
  getAllFeatureRows: vi.fn(),
  featureApi: { post: mocks.post },
  clearFeatureLogin: mocks.clearLogin,
}));

describe('website navigation transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pathname = '/websites/site-a/goals/create';
    document.body.style.overflow = '';
  });
  it('keeps website switching and account actions available in the shared compact website layout', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    try {
      const view = render(
        <Navigation
          user={{ id: 'user', username: 'admin' } as any}
          route={{ page: 'segments', websiteId: 'site-a' }}
          site={{ id: 'site-a', name: '网站 A', domain: 'a.test' }}
          width={228}
          onWidth={vi.fn()}
          websiteContextTarget={target}
        />,
      );
      const primary = screen.getByRole('navigation', { name: '业务导航' });
      expect(within(primary).getAllByRole('link')).toHaveLength(14);
      expect(within(primary).queryAllByRole('button')).toHaveLength(0);
      expect(primary.querySelectorAll('a[aria-current="page"]')).toHaveLength(1);
      for (const link of within(primary).getAllByRole('link')) {
        expect(link.querySelector('svg')).not.toBeNull();
        expect(link.getAttribute('href')).toContain('site-a');
      }
      expect(within(primary).queryByRole('link', { name: '深度分析' })).toBeNull();
      expect(view.container.querySelector('aside .site-switch')).toBeNull();
      fireEvent.click(within(target).getByRole('button', { name: /切换网站，当前/ }));
      expect(screen.getByText('个人空间')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '选择网站 网站 B' }));
      await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/websites/site-b/segments'));
      fireEvent.click(screen.getByRole('button', { name: '个人账户' }));
      expect(screen.getByRole('link', { name: '账户安全' })).toHaveAttribute(
        'href',
        '/settings/security',
      );
      expect(screen.getByRole('link', { name: '网站设置' })).toHaveAttribute(
        'href',
        '/websites/site-a/settings',
      );
      view.unmount();
      expect(target).toBeEmptyDOMElement();
    } finally {
      target.remove();
    }
  });
  it('keeps account focus inside an open mobile sidebar after pointer blur', () => {
    render(
      <Navigation
        user={{ id: 'user', username: 'admin' } as any}
        route={{ page: 'events', websiteId: 'site-a' }}
        site={{ id: 'site-a', name: '网站 A', domain: 'a.test' }}
        width={228}
        onWidth={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '页面导航' }));
    (document.activeElement as HTMLElement).blur();
    const account = screen.getByRole('button', { name: '个人账户' });
    fireEvent.click(account);
    expect(account).toHaveFocus();
    expect(screen.getByRole('link', { name: '账户安全' })).toBeInTheDocument();
    expect(fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(
      within(screen.getByRole('navigation', { name: '业务导航' }))
        .getAllByRole('link')
        .at(-1),
    ).toHaveFocus();
  });
  it('searches by domain and closes the picker with Escape while restoring focus', () => {
    render(
      <Navigation
        user={{ id: 'user', username: 'admin' } as any}
        route={{ page: 'events', websiteId: 'site-a' }}
        site={{ id: 'site-a', name: '网站 A', domain: 'a.test' }}
        width={228}
        onWidth={vi.fn()}
      />,
    );
    const picker = screen.getByRole('button', { name: /切换网站，当前/ });
    fireEvent.click(picker);
    const search = screen.getByRole('textbox', { name: '搜索网站' });
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: 'b.test' } });
    expect(screen.queryByRole('button', { name: '选择网站 网站 A' })).toBeNull();
    expect(screen.getByRole('button', { name: '选择网站 网站 B' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(picker).toHaveFocus();
  });
  it('restores picker focus when selecting the current website without navigating', () => {
    render(
      <Navigation
        user={{ id: 'user', username: 'admin' } as any}
        route={{ page: 'events', websiteId: 'site-a' }}
        site={{ id: 'site-a', name: '网站 A' }}
        width={228}
        onWidth={vi.fn()}
      />,
    );
    const picker = screen.getByRole('button', { name: /切换网站，当前/ });
    fireEvent.click(picker);
    fireEvent.keyDown(screen.getByRole('textbox', { name: '搜索网站' }), { key: 'ArrowDown' });
    const current = screen.getByRole('button', { name: '选择网站 网站 A' });
    expect(current).toHaveFocus();
    fireEvent.click(current);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(picker).toHaveFocus();
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it('uses resolved website ownership for the footer list, including personal sites with a stale team parameter', () => {
    const props = { user: { id: 'user', username: 'admin' } as any, width: 228, onWidth: vi.fn() };
    const view = render(
      <Navigation
        {...props}
        route={{ page: 'events', websiteId: 'site-a', teamId: 'stale-team' }}
        site={{ id: 'site-a', name: '个人网站', teamId: null }}
      />,
    );
    expect(screen.getByRole('link', { name: '网站列表' })).toHaveAttribute('href', '/websites');
    view.rerender(
      <Navigation
        {...props}
        route={{ page: 'events', websiteId: 'site-a', teamId: 'stale-team' }}
        site={{ id: 'site-a', name: '团队网站', teamId: 'owner-team' }}
      />,
    );
    expect(screen.getByRole('link', { name: '网站列表' })).toHaveAttribute(
      'href',
      '/websites?teamId=owner-team',
    );
  });
  it('restores account focus and dismisses nested mobile menus one layer at a time', () => {
    render(
      <Navigation
        user={{ id: 'user', username: 'admin' } as any}
        route={{ page: 'events', websiteId: 'site-a' }}
        width={228}
        onWidth={vi.fn()}
      />,
    );
    const account = screen.getByRole('button', { name: '个人账户' });
    fireEvent.click(account);
    screen.getByRole('link', { name: '账户安全' }).focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(account).toHaveFocus();
    const toggle = screen.getByRole('button', { name: '页面导航' });
    fireEvent.click(toggle);
    fireEvent.click(account);
    screen.getByRole('link', { name: '账户安全' }).focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(account).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(account).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
  });
  it.each([
    ['boards', '数据看板'],
    ['board-editor', '数据看板'],
    ['board-view', '数据看板'],
    ['board-design', '数据看板'],
    ['sharing', '分享管理'],
    ['links', '追踪管理'],
    ['link-editor', '追踪管理'],
    ['link-detail', '追踪管理'],
    ['pixels', '追踪管理'],
    ['pixel-editor', '追踪管理'],
    ['pixel-detail', '追踪管理'],
  ])('shows grouped global entries with the correct selection for %s', (page, selected) => {
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
      '数据总览',
      '网站管理',
      '数据看板',
      '追踪管理',
      '分享管理',
      '团队管理',
    ]);
    expect(within(primary).queryAllByRole('button')).toHaveLength(0);
    expect(within(primary).getByText('数据管理')).toBeInTheDocument();
    expect(within(primary).getByText('协作管理')).toBeInTheDocument();
    expect(primary.querySelectorAll('[data-navigation-group]')).toHaveLength(3);
    expect(primary.querySelectorAll('a[aria-current="page"]')).toHaveLength(1);
    expect(within(primary).getByRole('link', { name: selected })).toHaveAttribute(
      'aria-current',
      'page',
    );
    for (const [label, href] of [
      ['数据看板', '/boards'],
      ['分享管理', '/liekan/sharing'],
      ['追踪管理', '/links'],
    ])
      expect(within(primary).getByRole('link', { name: label })).toHaveAttribute('href', href);
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
    fireEvent.click(screen.getByRole('button', { name: '选择网站 网站 B' }));
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
    fireEvent.click(screen.getByRole('button', { name: '选择网站 网站 B' }));
    await screen.findByRole('dialog', { name: '当前修改尚未保存' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(mocks.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '放弃修改并切换' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.body.style.overflow).toBe('');
    expect(mocks.push).toHaveBeenCalledWith('/websites/site-b/goals');
  });
});
