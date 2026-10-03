import { describe, expect, it } from 'vitest';
import { conditionsToQuery } from './analysis';
import {
  featureHref,
  featureNavigationHref,
  featurePages,
  matchFeatureRoute,
  safeReturnHref,
} from '@/components/liekan/features/routes';
import {
  activeNavigationPage,
  geoPaths,
  globalNavigation,
  navigationFor,
  pageNavigation,
  websiteNavigation,
} from './navigation';

const site = '11111111-1111-4111-8111-111111111111';
const team = '22222222-2222-4222-8222-222222222222';
describe('navigation task boundaries', () => {
  it('restores global resource list state and the admin detail parent', () => {
    for (const [list, detail] of [
      ['links', 'link-detail'],
      ['pixels', 'pixel-editor'],
      ['boards', 'board-view'],
    ]) {
      const href = featureNavigationHref(
        { page: list },
        {
          page: '2',
          search: '研究',
          sort: '名称',
          direction: 'desc',
          date: '30day',
          offset: '-1',
          compare: 'yoy',
        },
        detail,
        { id: site },
      );
      const url = new URL(href, 'http://liekan.local');
      const route = matchFeatureRoute(url.pathname, Object.fromEntries(url.searchParams));
      const back = new URL(
        featureNavigationHref(route, Object.fromEntries(url.searchParams), list),
        'http://liekan.local',
      );
      expect(back.searchParams.get('search')).toBe('研究');
      expect(back.searchParams.get('page')).toBe('2');
      expect(back.searchParams.get('direction')).toBe('desc');
      expect(back.searchParams.get('offset')).toBe('-1');
      expect(back.searchParams.get('compare')).toBe('yoy');
    }
    expect(
      featureNavigationHref({ page: 'team-detail', id: team, context: 'admin' }, {}, 'teams'),
    ).toBe('/admin/teams');
  });
  it('preserves repeated conditions produced by the condition editor across analysis and export', () => {
    const filters = conditionsToQuery(
      [
        { name: 'country', operator: 'eq', value: 'CN' },
        { name: 'country', operator: 'eq', value: 'US' },
        { name: 'event', operator: 'eq', value: 'purchase' },
        { name: 'event', operator: 'eq', value: 'subscribe' },
      ],
      'any',
    );
    for (const page of ['events', 'exports']) {
      const url = new URL(
        featureNavigationHref({ page: 'sessions', websiteId: site }, filters, page),
        'http://liekan.local',
      );
      expect(url.searchParams.get('country1')).toBe('eq.US');
      expect(url.searchParams.get('event1')).toBe('eq.subscribe');
      expect(url.searchParams.get('match')).toBe('any');
    }
  });
  it('assigns every supplemental and GEO page to a scope and an accessible parent', () => {
    expect(featurePages).toHaveLength(68);
    expect(Object.keys(geoPaths)).toHaveLength(11);
    for (const page of [...featurePages.map(page => page.id), ...Object.keys(geoPaths)]) {
      expect(pageNavigation[page], page).toBeDefined();
      const parent = pageNavigation[page].parent;
      if (parent) expect(pageNavigation[parent], page).toBeDefined();
      expect(activeNavigationPage({ page })).toBeTruthy();
    }
    expect(globalNavigation.map(group => group.label)).toEqual([
      '工作台',
      '网站管理',
      '看板与分享',
      '团队协作',
      '链接与像素',
    ]);
    expect(websiteNavigation.map(group => group.label)).toEqual([
      '流量总览',
      'AI 抓取分析',
      '访客与来源',
      '内容与行为',
      '转化分析',
      '深度分析',
      '实时监测',
    ]);
  });
  it('keeps account and global resource URLs free of accidental website association', () => {
    for (const page of [
      'account',
      'security',
      'api-keys',
      'preferences',
      'boards',
      'links',
      'pixels',
      'sharing',
    ]) {
      const href = featureNavigationHref(
        { page: 'sessions', websiteId: site },
        { date: 'range:1:2:day', event: 'eq.purchase' },
        page,
      );
      const url = new URL(href, 'http://liekan.local');
      expect(url.searchParams.has('websiteId'), page).toBe(false);
      expect(url.searchParams.has('event'), page).toBe(false);
    }
  });
  it('binds website sharing explicitly and retains the website settings selection', () => {
    const href = featureNavigationHref({ page: 'overview', websiteId: site }, {}, 'sharing', {
      context: 'website',
    });
    const url = new URL(href, 'http://liekan.local');
    const route = matchFeatureRoute(url.pathname, Object.fromEntries(url.searchParams));
    expect(route).toMatchObject({ page: 'sharing', websiteId: site, context: 'website' });
    expect(navigationFor(route).scope).toBe('website');
    expect(activeNavigationPage(route)).toBe('website-settings');
    expect(matchFeatureRoute('/liekan/sharing', { websiteId: site })).toMatchObject({
      websiteId: undefined,
    });
  });
  it('keeps system resource details in system management and team resources independently scoped', () => {
    const url = new URL(
      featureHref('website-settings', { websiteId: site, context: 'admin', teamId: team }),
      'http://liekan.local',
    );
    const route = matchFeatureRoute(url.pathname, Object.fromEntries(url.searchParams));
    expect(route).toMatchObject({ page: 'website-settings', context: 'admin', teamId: undefined });
    expect(activeNavigationPage(route)).toBe('admin-websites');
    expect(matchFeatureRoute(`/teams/${team}`)).toMatchObject({
      page: 'team-detail',
      id: team,
      teamId: team,
    });
    expect(
      new URL(featureHref('links', { teamId: team }), 'http://liekan.local').searchParams.get(
        'teamId',
      ),
    ).toBe(team);
  });
  it('returns to the original website list while blocking foreign return destinations', () => {
    const listQuery = {
      scope: 'all',
      search: '研究 & AI',
      page: '2',
      sort: '网站',
      direction: 'desc',
    };
    const next = new URL(
      featureNavigationHref({ page: 'websites' }, listQuery, 'overview', { websiteId: site }),
      'http://liekan.local',
    );
    const returnTo = next.searchParams.get('returnTo');
    expect(new URL(returnTo, 'http://liekan.local').searchParams.get('search')).toBe('研究 & AI');
    expect(
      featureNavigationHref({ page: 'geo-human', websiteId: site }, { returnTo }, 'websites'),
    ).toBe(returnTo);
    for (const value of ['//foreign.example', '/login', '/websites/secret', '/\\foreign.example'])
      expect(safeReturnHref(value)).toBe('');
  });
  it('retains supported filters and clearly signals unsupported GEO filter clearing', () => {
    const route = { page: 'sessions', websiteId: site };
    const query = { date: 'range:1:2:day', drill_country: 'eq.CN' };
    const supported = new URL(featureNavigationHref(route, query, 'events'), 'http://liekan.local');
    expect(supported.searchParams.get('drill_country')).toBe('eq.CN');
    const geo = new URL(featureNavigationHref(route, query, 'geo-human'), 'http://liekan.local');
    expect(geo.searchParams.has('drill_country')).toBe(false);
    expect(geo.searchParams.get('clearedFilters')).toBe('1');
    expect(navigationFor({ page: 'exports', from: 'geo-ai-pages' })).toMatchObject({
      section: 'ai',
      parent: 'geo-ai-pages',
    });
  });
});
