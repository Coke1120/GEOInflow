import { describe, expect, it } from 'vitest';
import { needsWebsite } from '@/lib/liekan/contracts/navigation';
import { featureHref, featurePages, featureWebsiteSwitchHref, matchFeatureRoute } from './routes';

const uuid = '11111111-1111-4111-8111-111111111111';
describe('approved scene routing', () => {
  it('registers every approved supplemental scene without duplicate IDs', () => {
    expect(featurePages).toHaveLength(71);
    expect(new Set(featurePages.map(p => p.id)).size).toBe(71);
    for (const p of featurePages)
      expect(matchFeatureRoute(`/liekan/${p.id}`, { websiteId: uuid, id: uuid })).toMatchObject(
        p.id === 'help'
          ? { page: 'help' }
          : {
              page: p.id,
              websiteId: needsWebsite({ page: p.id }) ? uuid : undefined,
              id: ['ai-chat', 'ai-config', 'help'].includes(p.id) ? undefined : uuid,
            },
      );
  });
  it('preserves route opt-out, team context and safe query values', () => {
    expect(matchFeatureRoute('/websites', { legacy: '1' })).toBeNull();
    expect(matchFeatureRoute('/liekan')).toMatchObject({ page: 'dashboard' });
    expect(matchFeatureRoute(`/teams/${uuid}/websites`)).toMatchObject({
      page: 'websites',
      teamId: uuid,
    });
    const href = featureHref('session-detail', {
      websiteId: uuid,
      id: uuid,
      drill_event: 'eq.a&b',
      date: 'range:0:100:day',
    });
    expect(new URL(href, 'http://localhost').searchParams.get('drill_event')).toBe('eq.a&b');
  });
  it('routes every private scene through an implemented page and preserves the GEO overview', () => {
    for (const page of featurePages.filter(p => !['login', 'login-2fa', 'sso'].includes(p.id))) {
      const url = new URL(featureHref(page.id, { websiteId: uuid, id: uuid }), 'http://localhost');
      expect(
        matchFeatureRoute(url.pathname, Object.fromEntries(url.searchParams)),
        page.id,
      ).toMatchObject({ page: page.id });
    }
    expect(featureHref('annotations', { websiteId: uuid })).toBe(
      `/liekan/annotations?websiteId=${uuid}`,
    );
    expect(featureHref('overview', { websiteId: uuid })).toBe(`/websites/${uuid}/geo`);
  });
  it('keeps the user dashboard global when opened from a team workspace', () => {
    for (const page of ['dashboard', 'dashboard-edit']) {
      const url = new URL(featureHref(page, { teamId: uuid }), 'http://localhost');
      expect(url.searchParams.has('teamId')).toBe(false);
      expect(matchFeatureRoute(url.pathname, { teamId: uuid })?.teamId).toBeUndefined();
      expect(matchFeatureRoute(`/liekan/${page}`, { teamId: uuid })?.teamId).toBeUndefined();
    }
    expect(matchFeatureRoute('/boards', { teamId: uuid })?.teamId).toBe(uuid);
  });
  it('clears website-owned records and filters while keeping only the time selection', () => {
    const websiteId = '22222222-2222-4222-8222-222222222222';
    const query = {
      date: 'range:0:100:day',
      unit: 'day',
      offset: '2',
      compare: 'prev',
      segment: uuid,
      cohort: uuid,
      retentionDate: '2026-10-01',
      retentionDay: '1',
      attributionStep: 'purchase',
      attributionModel: 'first-click',
      attributionType: 'event',
      attributionSource: 'old-source',
      event: 'eq.old',
      drill_country: 'eq.CN',
      spf0: '1.eq.plan.old',
    };
    for (const [page, list] of [
      ['session-detail', 'sessions'],
      ['replay-player', 'replays'],
      ['event-detail', 'events'],
      ['path-detail', 'journeys'],
      ['goal-editor', 'goals'],
      ['funnel-editor', 'funnels'],
      ['segment-editor', 'segments'],
      ['cohort-editor', 'cohorts'],
    ]) {
      const url = new URL(
        featureWebsiteSwitchHref({ page, id: uuid, teamId: uuid }, websiteId, query),
        'http://localhost',
      );
      expect(matchFeatureRoute(url.pathname, Object.fromEntries(url.searchParams))).toMatchObject({
        page: list,
        websiteId,
        teamId: undefined,
      });
      expect(Object.fromEntries(url.searchParams)).toEqual({
        date: query.date,
        unit: 'day',
        offset: '2',
        compare: 'prev',
      });
    }
  });
  it('preserves independent link, pixel and board records on a website switch', () => {
    for (const page of [
      'link-editor',
      'link-detail',
      'pixel-editor',
      'pixel-detail',
      'board-editor',
      'board-design',
      'board-view',
    ]) {
      const url = new URL(
        featureWebsiteSwitchHref({ page, id: uuid, teamId: uuid }, uuid, { event: 'eq.old' }),
        'http://localhost',
      );
      expect(matchFeatureRoute(url.pathname, Object.fromEntries(url.searchParams))).toMatchObject({
        page,
        id: uuid,
        teamId: uuid,
      });
      expect(url.searchParams.has('event')).toBe(false);
    }
  });
});
