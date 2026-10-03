import { afterEach, describe, expect, it, vi } from 'vitest';
import { featureApi, getFeatureSites } from './features-client';

afterEach(() => vi.restoreAllMocks());
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
