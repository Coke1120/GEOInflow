import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  activeNavigationPage,
  analysisSourcePage,
  websiteAnalysisTabs,
  websiteNavigation,
} from '@/lib/liekan/contracts/navigation';
import { AnalysisTabs } from './AnalysisTabs';
import { featureNavigationHref } from './features/routes';

vi.mock('next/link', () => ({
  useLinkStatus: () => ({ pending: false }),
  default: ({ children, prefetch: _, ...props }: any) => <a {...props}>{children}</a>,
}));
describe('website analysis families', () => {
  it.each([
    ['links', '链接追踪'],
    ['link-editor', '链接追踪'],
    ['link-detail', '链接追踪'],
    ['pixels', '图片追踪'],
    ['pixel-editor', '图片追踪'],
    ['pixel-detail', '图片追踪'],
  ])('selects the tracking tab for %s and retains its owner and date', (page, selected) => {
    const route = { page, teamId: 'team-a', id: 'resource-a' };
    const query = { date: '7day', search: 'old-resource', page: '3', country: 'CN' };
    render(<AnalysisTabs route={route} href={page => featureNavigationHref(route, query, page)} />);
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: selected })).toHaveAttribute('aria-selected', 'true');
    for (const [label, path] of [
      ['链接追踪', '/links'],
      ['图片追踪', '/pixels'],
    ]) {
      const tab = screen.getByRole('tab', { name: label });
      const url = new URL(tab.getAttribute('href'), 'http://liekan.local');
      expect(url.pathname).toBe(path);
      expect(url.searchParams.get('teamId')).toBe('team-a');
      expect(url.searchParams.get('date')).toBe('7day');
      for (const key of ['id', 'websiteId', 'search', 'page', 'country', 'returnTo'])
        expect(url.searchParams.has(key)).toBe(false);
    }
    const selectedTab = screen.getByRole('tab', { name: selected });
    selectedTab.focus();
    fireEvent.keyDown(selectedTab, { key: 'ArrowRight' });
    expect(
      screen.getByRole('tab', { name: selected === '链接追踪' ? '图片追踪' : '链接追踪' }),
    ).toHaveFocus();
  });
  it('keeps all original analysis views reachable through 14 menu entries, tabs and saved segments', () => {
    const menus = websiteNavigation.flatMap(group => group.children || [group]);
    expect(menus).toHaveLength(14);
    expect(menus.filter(item => item.page === 'help')).toHaveLength(0);
    const analysisMenus = menus.filter(item => item.page !== 'help');
    expect(analysisMenus).toHaveLength(14);
    const views = new Set([
      ...analysisMenus.map(item => item.page),
      ...Object.values(websiteAnalysisTabs)
        .flat()
        .map(item => item.page),
      'segments',
    ]);
    expect(views.size).toBe(30);
    expect(views.has('geo-search-engines')).toBe(true);
    expect(views.has('geo-keywords')).toBe(true);
  });
  it('keeps the current tracking date when switching back from a different resource tab', () => {
    const route = { page: 'pixels', teamId: 'team-a' };
    const query = {
      date: '30day',
      returnTo: '/links?teamId=team-a&date=7day&search=old-resource&page=3',
    };
    render(<AnalysisTabs route={route} href={page => featureNavigationHref(route, query, page)} />);
    const url = new URL(
      screen.getByRole('tab', { name: '链接追踪' }).getAttribute('href'),
      'http://liekan.local',
    );
    expect(url.pathname).toBe('/links');
    expect(url.searchParams.get('date')).toBe('30day');
    expect(url.searchParams.get('teamId')).toBe('team-a');
    for (const key of ['search', 'page', 'returnTo']) expect(url.searchParams.has(key)).toBe(false);
  });
  it.each([
    ['utm', 'geo-sources'],
    ['event-detail', 'geo-content'],
    ['performance', 'geo-content'],
    ['replay-player', 'sessions'],
    ['goal-editor', 'geo-conversions'],
    ['revenue', 'geo-conversions'],
    ['segment-editor', 'cohorts'],
    ['path-detail', 'cohorts'],
    ['compare', 'cohorts'],
  ])('selects the menu for the %s deep link', (page, family) => {
    expect(activeNavigationPage({ page, websiteId: 'site-a' })).toBe(family);
  });
  it('keeps the analysis source independent from the merged menu for filters and detail pages', () => {
    expect(analysisSourcePage('path-detail')).toBe('journeys');
    expect(
      activeNavigationPage({ page: 'filters', from: 'path-detail', websiteId: 'site-a' }),
    ).toBe('cohorts');
    expect(
      activeNavigationPage({ page: 'website-settings', context: 'admin', websiteId: 'site-a' }),
    ).toBe('admin-websites');
  });
  it('selects the detail view tab and retains date and website on tab navigation', () => {
    const route = { page: 'event-detail', websiteId: 'site-a', id: 'event-a' };
    const query = { date: '30day', country: 'CN' };
    render(<AnalysisTabs route={route} href={page => featureNavigationHref(route, query, page)} />);
    expect(screen.getByRole('tab', { name: '事件分析' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '页面性能' })).toHaveAttribute(
      'href',
      '/websites/site-a/performance?date=30day&country=CN',
    );
    expect(screen.getByRole('tab', { name: '页面与内容' }).getAttribute('href')).toContain(
      'clearedFilters=1',
    );
    screen.getByRole('tab', { name: '事件分析' }).focus();
    fireEvent.keyDown(document.activeElement, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: '热力图' })).toHaveFocus();
  });
});

it('places search engines before keywords and clears site-owned detail conditions across tabs', () => {
  const route = { page: 'geo-keywords', websiteId: 'site-a' };
  const query = {
    date: '24hour',
    engine: 'Bing',
    status: 'available',
    keywordSnapshot: 'old',
    page: '3',
    sort: 'sessions',
    filter: '传统搜索',
  };
  render(<AnalysisTabs route={route} href={page => featureNavigationHref(route, query, page)} />);
  expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual([
    '来源渠道',
    '搜索引擎',
    '来源关键词',
    'UTM 活动',
  ]);
  const tab = screen.getByRole('tab', { name: '搜索引擎' });
  expect(tab).toHaveAttribute('href', '/websites/site-a/geo/human/search-engines?date=24hour');
  expect(activeNavigationPage({ page: 'geo-search-engines', websiteId: 'site-a' })).toBe(
    'geo-sources',
  );
});
