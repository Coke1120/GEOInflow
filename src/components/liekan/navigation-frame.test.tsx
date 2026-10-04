import { render, screen, act } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigationFrame } from './NavigationFrame';
import { Navigation, useSidebarWidth } from './Navigation';
const state = vi.hoisted(() => ({ pathname: '/websites', mounts: 0, unmounts: 0 }));
vi.mock('@/lib/liekan/upstream/client', () => ({
  useNavigation: () => ({ pathname: state.pathname, query: {} }),
}));
vi.mock('./Navigation', async original => {
  const actual = await original<typeof import('./Navigation')>();
  return {
    ...actual,
    NavigationView: ({ route, width }: any) => {
      useEffect(() => {
        state.mounts++;
        return () => {
          state.unmounts++;
        };
      }, []);
      return (
        <aside data-test="navigation" style={{ width }}>
          {route.page}
        </aside>
      );
    },
  };
});
const user = { id: 'owner', username: 'owner', role: 'admin' };
function FeatureLayout() {
  const [width, onWidth] = useSidebarWidth();
  return (
    <>
      <Navigation user={user} route={{ page: 'websites' }} width={width} onWidth={onWidth} />
      <input aria-label="draft" defaultValue="初始" />
    </>
  );
}
function GeoLayout() {
  const [width, onWidth] = useSidebarWidth();
  return (
    <Navigation
      user={user}
      route={{ page: 'geo-overview', websiteId: 'site' }}
      width={width}
      onWidth={onWidth}
    />
  );
}
beforeEach(() => {
  state.pathname = '/websites';
  state.mounts = 0;
  state.unmounts = 0;
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());
describe('persistent navigation presentation', () => {
  it('preserves the navigation instance and saved width across different body layouts', () => {
    localStorage.setItem('lk-side-w', '320');
    const view = render(
      <NavigationFrame user={user} route={{ page: 'websites' }}>
        <FeatureLayout />
      </NavigationFrame>,
    );
    const node = screen.getByTestId('navigation');
    expect(node).toHaveStyle({ width: '320px' });
    state.pathname = '/websites/site/geo';
    view.rerender(
      <NavigationFrame user={user} route={{ page: 'geo-overview', websiteId: 'site' }}>
        <GeoLayout />
      </NavigationFrame>,
    );
    expect(screen.getByTestId('navigation')).toBe(node);
    expect(node).toHaveTextContent('geo-overview');
    expect(node).toHaveStyle({ width: '320px' });
    expect(screen.queryByLabelText('draft')).not.toBeInTheDocument();
    expect(state.mounts).toBe(1);
    view.unmount();
    expect(state.unmounts).toBe(1);
  });
  it('keeps authentication and public preview flows standalone', () => {
    render(
      <NavigationFrame enabled={false} user={user} route={{ page: 'share-preview' }}>
        <p>公开预览</p>
      </NavigationFrame>,
    );
    expect(screen.queryByTestId('navigation')).not.toBeInTheDocument();
    expect(screen.getByText('公开预览')).toBeInTheDocument();
  });
  it('falls back to default width when storage is unavailable and permits resizing', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('unavailable');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('unavailable');
    });
    function Width() {
      const [width, set] = useSidebarWidth();
      return <button onClick={() => set(180)}>{width}</button>;
    }
    render(<Width />);
    expect(screen.getByRole('button')).toHaveTextContent('228');
    act(() => screen.getByRole('button').click());
    expect(screen.getByRole('button')).toHaveTextContent('180');
  });
});
