import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Navigation } from './Navigation';

const mocks = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/link', () => ({
  default: ({ children, prefetch: _prefetch, ...props }: any) => <a {...props}>{children}</a>,
}));
vi.mock('@/lib/liekan/upstream/client', () => ({
  useNavigation: () => ({
    pathname: '/websites/site-a/goals/create',
    query: {},
    router: { push: mocks.push },
  }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ clear: vi.fn() }),
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
  featureApi: {},
  clearFeatureLogin: vi.fn(),
}));

describe('website navigation dialog transitions', () => {
  beforeEach(() => {
    mocks.push.mockClear();
    document.body.style.overflow = '';
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
