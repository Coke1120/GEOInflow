// @vitest-environment node
import { describe, expect, it } from 'vitest';
import legacyBrowserRanges from '../../../../config/liekan/bot-ranges.json';
import { crawlerPolicyInputSchema } from '../contracts/crawlers';
import { crawlerCapabilities, crawlerSnapshot } from '../help/catalog';
import { helpTranslator } from '../i18n/help';
import { translateSystemText } from '../i18n/text';
import { classifyBot, LEGACY_BOT_RULES } from '../rules/bots';
import { bundledVerificationSnapshots, verifyBotIpEvidence } from '../rules/verify';
import { crawlerCatalog } from './catalog';
import { getCrawler } from './directory';
import { isQualifiedRangeContent, rangeBaselines } from './range-check';
import { rangeSources } from './range-sources';
import { CRAWLER_REGISTRY_VERSION } from './registry';

const identities = [
  {
    id: 'kimibot',
    name: 'KimiBot',
    platformId: 'kimi',
    type: 'training',
    label: '训练',
    sourceId: 'kimi-bot',
    feed: 'https://www.kimi.ai/policies/kimibot.json',
    documentation: 'https://www.kimi.ai/policies/kimi-crawlers',
  },
  {
    id: 'kimi-searchbot',
    name: 'Kimi-SearchBot',
    platformId: 'kimi',
    type: 'search',
    label: '搜索',
    sourceId: 'kimi-search',
    feed: 'https://www.kimi.ai/policies/kimi-searchbot.json',
    documentation: 'https://www.kimi.ai/policies/kimi-crawlers',
  },
  {
    id: 'kimi-user',
    name: 'Kimi-User',
    platformId: 'kimi',
    type: 'user',
    label: '用户触发',
    sourceId: 'kimi-user',
    feed: 'https://www.kimi.ai/policies/kimi-user.json',
    documentation: 'https://www.kimi.ai/policies/kimi-crawlers',
  },
  {
    id: 'hyspider',
    name: 'HySpider',
    platformId: 'tencent',
    type: 'training',
    label: '训练',
    sourceId: 'tencent-hyspider',
    feed: 'https://hy.tencent.com/policy/hyspider.json',
    documentation: 'https://hy.tencent.com/polices/hy-crawlers',
  },
] as const;

describe('reviewed Kimi and Tencent crawler identities', () => {
  it.each(identities)(
    'publishes the reviewed $name purpose, help, and independent source',
    item => {
      expect(CRAWLER_REGISTRY_VERSION).toBe('crawler-registry-v2');
      const entry = crawlerCatalog.find(entry => entry.id === item.id);
      const directory = getCrawler(item.id);
      expect(directory).toMatchObject({
        name: item.name,
        type: item.type,
        platformId: item.platformId,
        kind: 'http_crawler',
        uaSelector: item.name,
        aiEligible: true,
        evidence: 'operator',
        reviewedAt: '2026-10-21',
        documentationUrl: item.documentation,
        control: { remote: false, nginx: false },
        robotsToken: item.name,
        robotsApplicability: item.id === 'kimi-user' ? 'user_triggered_caveat' : 'applicable',
      });
      expect(classifyBot(entry.metadata.ua)).toMatchObject({
        crawlerId: item.id,
        name: item.name,
        type: item.label,
        aiEligible: true,
        matchMode: 'token',
      });
      expect(crawlerCapabilities(entry.metadata)).toMatchObject({
        rule: { crawlerId: item.id },
        ip: true,
      });
      expect(entry.metadata.feeds.map(feed => feed.url)).toEqual([item.feed]);
      expect(crawlerSnapshot(entry.metadata)?.source).toBe(item.feed);
      const source = rangeSources.find(source => source.id === item.sourceId);
      expect(source).toMatchObject({
        url: item.feed,
        names: [item.name],
        crawlerIds: [item.id],
        reviewedAt: '2026-10-21',
      });
      expect(isQualifiedRangeContent(source, rangeBaselines[item.sourceId].content)).toBe(true);
      expect(
        crawlerPolicyInputSchema.safeParse({
          name: 'Crawler policy',
          botIds: [item.id],
          paths: [{ value: '/', match: 'prefix' }],
          action: 'block',
          expectedAccess: 'block',
        }).success,
      ).toBe(false);
      expect(LEGACY_BOT_RULES.some(rule => rule.name === item.name)).toBe(false);
      expect(Object.hasOwn(legacyBrowserRanges, item.name)).toBe(false);
    },
  );

  it.each(identities)('requires the exact bounded $name UA and trusted matching evidence', item => {
    const snapshot = bundledVerificationSnapshots[item.name];
    const ip = snapshot.prefixes[0].split('/')[0];
    const time = snapshot.retrievedAt;
    const now = Date.parse(time);
    const verify = (ua: string, address = ip, trustedIp = true) =>
      verifyBotIpEvidence(address, item.name, ua, time, bundledVerificationSnapshots, {
        now,
        trustedIp,
      });
    expect(verify(`${item.name}/1.0`)).toMatchObject({
      status: 'verified_range',
      reason: 'verified_range',
      version: snapshot.version,
      observedAt: time,
    });
    expect(verify(`${item.name}/1.0`, '192.0.2.1')).toMatchObject({
      status: 'range_mismatch',
      reason: 'range_mismatch',
    });
    expect(verify(`${item.name}/1.0`, ip, false).reason).toBe('untrusted_ip');
    for (const ua of [
      'Mozilla/5.0',
      `Not${item.name}/1.0`,
      `${item.name}-Unofficial/1.0`,
      `${item.name}.example`,
      `Mozilla/5.0 (+https://example.com/${item.name})`,
      `Mozilla/5.0 (https://example.com/?ua=(${item.name}/1.0))`,
    ]) {
      expect(classifyBot(ua)).toMatchObject({ recognition: 'unknown', aiEligible: false });
      expect(verify(ua).reason).toBe('unmapped_identity');
    }
    expect(verify(`${item.name}/1.0 GPTBot/1.0`).reason).toBe('ambiguous_name');
    expect(
      verifyBotIpEvidence(ip, item.name, item.name, time, bundledVerificationSnapshots, {
        trustedIp: true,
        now: now + 8 * 86400000,
      }).reason,
    ).toBe('stale_snapshot');
    expect(
      verifyBotIpEvidence(
        ip,
        item.name,
        item.name,
        '2020-01-01T00:00:00Z',
        bundledVerificationSnapshots,
        { trustedIp: true, now },
      ).reason,
    ).toBe('stale_snapshot');
  });

  it('preserves independent Kimi snapshot provenance when published addresses coincide', () => {
    const kimi = identities.filter(item => item.platformId === 'kimi');
    const content = kimi.map(item => rangeBaselines[item.sourceId].content);
    expect(content[0].prefixes).toEqual(content[1].prefixes);
    expect(content[0].prefixes).toEqual(content[2].prefixes);
    expect(new Set(content.map(item => item.version)).size).toBe(3);
    const now = Math.max(
      ...kimi.map(item => Date.parse(bundledVerificationSnapshots[item.name].retrievedAt)),
    );
    for (const item of kimi) {
      const snapshot = bundledVerificationSnapshots[item.name];
      const ip = snapshot.prefixes[0].split('/')[0];
      const other = kimi.find(other => other.id !== item.id);
      expect(
        verifyBotIpEvidence(
          ip,
          item.name,
          other.name,
          snapshot.retrievedAt,
          bundledVerificationSnapshots,
          { trustedIp: true, now },
        ).reason,
      ).toBe('unmapped_identity');
      expect(
        verifyBotIpEvidence(
          ip,
          item.name,
          item.name,
          snapshot.retrievedAt,
          { [item.name]: bundledVerificationSnapshots[other.name] },
          { trustedIp: true, now },
        ).reason,
      ).toBe('invalid_snapshot');
    }
    expect(classifyBot('KimiBot/1.0 Kimi-SearchBot/1.0')).toMatchObject({
      recognition: 'ambiguous',
      candidateIds: ['kimi-searchbot', 'kimibot'],
    });
  });

  it.each(identities)('translates the $name directory impact and help text', item => {
    const metadata = crawlerCatalog.find(entry => entry.id === item.id).metadata;
    expect(translateSystemText(metadata.summary, 'en-US')).not.toMatch(/[\u3400-\u9fff]/u);
    for (const text of [
      metadata.summary,
      metadata.verification,
      metadata.robots,
      metadata.advice,
      ...metadata.feeds.map(feed => feed.label),
      ...metadata.sources.map(source => source.label),
    ]) {
      expect(helpTranslator.system(text, 'en-US')).not.toMatch(/[\u3400-\u9fff]/u);
    }
  });
});
