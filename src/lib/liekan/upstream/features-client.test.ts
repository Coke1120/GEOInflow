import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getClientAuthToken, setClientAuthToken } from '@/lib/client';
import { setReturnUrl } from '@/lib/return-url';
import { setUser, useApp } from '@/store/app';
import {
  acceptFeatureLogin,
  clearFeatureLogin,
  featureApi,
  getFeatureSites,
  resumeFeatureLogin,
} from './features-client';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('saved login restoration', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setUser(null);
  });
  it('restores a persisted token, verifies live identity and consumes a safe return path', async () => {
    setClientAuthToken('saved-token');
    setReturnUrl('/websites');
    const fetch = vi.fn().mockResolvedValue(Response.json({ id: 'user-1', username: 'owner' }));
    vi.stubGlobal('fetch', fetch);
    expect(await resumeFeatureLogin()).toBe('/websites');
    expect(fetch.mock.calls[0][1].headers.authorization).toBe('Bearer saved-token');
    expect(useApp.getState().user.id).toBe('user-1');
    expect(getClientAuthToken()).toBe('saved-token');
    expect(sessionStorage.getItem('umami.return-url')).toBeNull();
  });
  it('leaves the login form available without a saved session', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await resumeFeatureLogin()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('clears an expired session after a verified 401', async () => {
    setClientAuthToken('expired');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({}, { status: 401 })));
    expect(await resumeFeatureLogin()).toBeNull();
    expect(getClientAuthToken()).toBeUndefined();
    expect(useApp.getState().user).toBeNull();
  });
  it.each(['network', 'service'])(
    'retains the saved session during a transient %s failure',
    async kind => {
      setClientAuthToken('saved');
      vi.stubGlobal(
        'fetch',
        kind === 'network'
          ? vi.fn().mockRejectedValue(new Error('offline'))
          : vi.fn().mockResolvedValue(Response.json({}, { status: 503 })),
      );
      await expect(resumeFeatureLogin()).rejects.toThrow();
      expect(getClientAuthToken()).toBe('saved');
    },
  );
  it.each([200, 401])(
    'ignores a stale restoration response after a newer login (HTTP %s)',
    async status => {
      setClientAuthToken('previous');
      let resolve!: (value: Response) => void;
      vi.stubGlobal(
        'fetch',
        vi.fn().mockReturnValue(
          new Promise<Response>(r => {
            resolve = r;
          }),
        ),
      );
      const pending = resumeFeatureLogin();
      acceptFeatureLogin({ token: 'new-session', user: { id: 'new-user' } });
      resolve(Response.json({ id: 'old-user' }, { status }));
      expect(await pending).toBeNull();
      expect(getClientAuthToken()).toBe('new-session');
      expect(useApp.getState().user.id).toBe('new-user');
    },
  );
  it('aborting restoration prevents late identity changes and leaves return paths intact', async () => {
    setClientAuthToken('saved');
    setReturnUrl('/websites');
    let resolve!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise<Response>(r => {
          resolve = r;
        }),
      ),
    );
    const controller = new AbortController();
    const pending = resumeFeatureLogin(controller.signal);
    controller.abort();
    resolve(Response.json({ id: 'user-1' }));
    expect(await pending).toBeNull();
    expect(useApp.getState().user).toBeNull();
    expect(sessionStorage.getItem('umami.return-url')).not.toBeNull();
  });
  it('logout clears the persistent token and prevents login restoration', async () => {
    acceptFeatureLogin({ token: 'saved', user: { id: 'user-1' } });
    expect(getClientAuthToken()).toBe('saved');
    clearFeatureLogin();
    expect(await resumeFeatureLogin()).toBeNull();
    expect(getClientAuthToken()).toBeUndefined();
    expect(useApp.getState().user).toBeNull();
  });
});
describe('accessible website collection', () => {
  it('includes member and read-only team websites in all accessible sources', async () => {
    const get = vi.spyOn(featureApi, 'get').mockImplementation(async path => {
      if (path === '/me/websites') return [{ id: 'personal', name: '个人网站' }];
      if (path === '/me/teams')
        return [
          { id: 'member-team', role: 'team-member' },
          { id: 'reader-team', role: 'team-view-only' },
        ];
      if (path === '/teams/member-team/websites') return [{ id: 'member-site', name: '成员网站' }];
      if (path === '/teams/reader-team/websites') return [{ id: 'reader-site', name: '只读网站' }];
      throw new Error(`Unexpected fixture request ${path}`);
    });
    const rows = await getFeatureSites(undefined, undefined, 'all');
    expect(rows.map(site => site.id)).toEqual(['personal', 'member-site', 'reader-site']);
    expect(get).toHaveBeenCalledWith('/teams/reader-team/websites', expect.any(Object), undefined);
  });
  it('keeps the default personal list independent of team enumeration', async () => {
    const get = vi.spyOn(featureApi, 'get').mockResolvedValue([{ id: 'personal' }]);
    expect(await getFeatureSites(undefined, undefined, 'personal')).toEqual([{ id: 'personal' }]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0]).toBe('/me/websites');
    expect(get.mock.calls[0][1]).not.toHaveProperty('includeTeams');
  });
});
