import { describe, expect, it } from 'vitest';
import {
  featureHref,
  featureNavigationHref,
  matchFeatureRoute,
} from '@/components/liekan/features/routes';
import { hasDateControl, navigationFor, needsWebsite } from '../contracts/navigation';
import {
  crawlerCapabilities,
  crawlerRobotsDraft,
  crawlerSnapshot,
  helpArticles,
  helpCrawlers,
  helpLocation,
  searchArticles,
  searchCrawlers,
  snapshotState,
} from './catalog';

describe('help scope and evidence', () => {
  it('clears private site, resource and date context when entering global help', () => {
    const query = {
      websiteId: 'site-a',
      teamId: 'team-a',
      id: 'session-a',
      date: '7day',
      live: '1',
      search: '192.0.2.1',
      returnTo: '/websites?search=private',
    };
    expect(
      featureNavigationHref(
        { page: 'geo-logs', websiteId: 'site-a', teamId: 'team-a' },
        query,
        'help',
      ),
    ).toBe('/liekan/help');
    expect(featureHref('help', { ...query, article: 'metric-pv' })).toBe(
      '/liekan/help?article=metric-pv',
    );
    const route = matchFeatureRoute('/liekan/help', query);
    expect(route).toEqual({ page: 'help' });
    expect(needsWebsite(route)).toBe(false);
    expect(hasDateControl(route)).toBe(false);
    expect(navigationFor(route)).toMatchObject({ scope: 'global', title: '帮助中心' });
    expect(featureHref('help', { article: '../../bad', crawler: '<script>' })).toBe('/liekan/help');
  });
  it('keeps every deep link and related article resolvable with safe source addresses', () => {
    const ids = [...helpArticles, ...helpCrawlers].map(item => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const article of helpArticles) {
      expect(helpLocation({ article: article.id }).article).toBe(article);
      for (const id of article.related)
        expect(
          helpArticles.some(item => item.id === id),
          id,
        ).toBe(true);
      expect(article.blocks.length).toBeGreaterThan(0);
    }
    for (const crawler of helpCrawlers) {
      expect(helpLocation({ crawler: crawler.id }).crawler).toBe(crawler);
      expect(crawler.sources.length).toBeGreaterThan(0);
      for (const link of [...crawler.sources, ...crawler.feeds])
        expect(new URL(link.url).protocol).toBe('https:');
    }
    expect(helpLocation({ article: 'removed' }).invalid).toBe(true);
    expect(helpLocation({ article: 'metric-pv', crawler: 'gptbot' }).invalid).toBe(true);
    expect(helpLocation({ section: 'wrong' }).invalid).toBe(true);
  });
  it('searches Chinese names, ASCII aliases and full-width abbreviations using literal multi-term matching', () => {
    expect(searchArticles('ＰＶ 页面').some(item => item.id === 'metric-pv')).toBe(true);
    expect(searchCrawlers('openai GPTBOT').map(item => item.name)).toEqual(['GPTBot']);
    expect(searchCrawlers('ByteDance').map(item => item.name)).toEqual(['Bytespider']);
    expect(searchArticles('(.*)+[unfindable')).toEqual([]);
    expect(searchCrawlers('does-not-exist')).toEqual([]);
    expect(searchCrawlers('', '训练', 'Google', 'control').map(item => item.name)).toEqual([
      'Google-Extended',
    ]);
  });
  it('keeps control tokens separate from HTTP classification and IP support', () => {
    const controls = helpCrawlers.filter(item => item.kind === 'control');
    expect(controls.map(item => item.name)).toEqual([
      'Google-Extended',
      'Googlebot-News',
      'Applebot-Extended',
    ]);
    for (const control of controls) {
      expect(crawlerCapabilities(control)).toEqual({ rule: undefined, ip: false });
      expect(crawlerSnapshot(control)).toBeUndefined();
      expect(control.token).toBe('');
      expect(crawlerRobotsDraft(control)).toContain(`User-agent: ${control.name}`);
    }
  });
  it('reports actual default rules, including family grouping, separately from collected feeds', () => {
    const get = (name: string) => helpCrawlers.find(item => item.name === name)!;
    expect(crawlerCapabilities(get('GPTBot'))).toMatchObject({
      rule: { name: 'GPTBot' },
      ip: true,
    });
    expect(crawlerCapabilities(get('Googlebot-Image'))).toMatchObject({
      rule: { name: 'Googlebot' },
      ip: true,
    });
    expect(crawlerCapabilities(get('ClaudeBot'))).toMatchObject({
      rule: { name: 'ClaudeBot' },
      ip: false,
    });
    expect(get('ClaudeBot').feeds[0].url).toBe('https://claude.com/crawling/bots.json');
    expect(crawlerCapabilities(get('OAI-AdsBot'))).toEqual({ rule: undefined, ip: false });
    expect(crawlerRobotsDraft(get('PetalBot'))).toBeUndefined();
    expect(get('Bytespider').evidence).toBe('observed');
  });
  it('treats old, future, invalid and missing IP snapshots explicitly', () => {
    const range = crawlerSnapshot(helpCrawlers.find(item => item.name === 'GPTBot')!)!;
    expect(range.prefixes.length).toBeGreaterThan(0);
    const fetched = Date.parse(range.retrievedAt);
    expect(snapshotState(range, fetched + 7 * 86400000)).toBe('fresh');
    expect(snapshotState(range, fetched + 7 * 86400000 + 1)).toBe('stale');
    expect(snapshotState(range, fetched - 8 * 86400000)).toBe('stale');
    expect(snapshotState({ ...range, retrievedAt: 'invalid' })).toBe('stale');
    expect(snapshotState(undefined)).toBe('missing');
  });
});
