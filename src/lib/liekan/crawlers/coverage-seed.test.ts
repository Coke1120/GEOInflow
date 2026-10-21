// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ catalog: undefined as any }));
vi.mock('./published', () => ({ getPublishedCatalog: () => h.catalog }));
import { getBundledPublishedCatalog } from './catalog-seed';
import { classifyBot, getBotRules } from '../rules/bots';
import { classifyEntrySource, referralForHost, platformForReferral, platformSupportsReferralRatio, referralPlatformName } from '../contracts/sources';
import { channelFilterColumn } from '../upstream/filter-extension';
import { getRangeBaselines, checkRangeSource } from './range-check';
import { getRangeSources } from './range-sources';
import { verifyBotIpEvidence } from '../rules/verify';
beforeEach(() => { h.catalog = structuredClone(getBundledPublishedCatalog()); });
describe('reviewed platform coverage', () => {
  it('registers every requested domestic product with explicit status and product boundaries', () => {
    const products = h.catalog.payload.products;
    for (const id of ['deepseek-chat','deepseek-search','doubao','doubao-work','doubao-aily','qwen','yuanbao','wechat-search','workbuddy','ima','qclaw','codebuddy','qingyan','autoglm','spark','metaso','minimax-agent','stepclaw','tiangong','namiai','celia','pangu','manus','cue','meta-muse'])
      expect(products.find(product => product.id === id)).toMatchObject({ supportStatus: 'pending', identityIds: [] });
    expect(products.find(product => product.id === 'doubao-aily').aliases).toContain('飞书 aily');
    expect(h.catalog.payload.identities.filter(item => /deepseek|doubao|cue|workbuddy|coherebot/i.test(item.name))).toEqual([]);
    expect(classifyBot('Mozilla/5.0 MicroMessenger/8.0')).toMatchObject({ recognition: 'unknown', aiEligible: false });
  });
  it.each([['ExaSearchBot','exasearchbot'], ['ExaUser','exauser'], ['Kagibot','kagibot']])('identifies %s with complete token boundaries', (token, id) => {
    expect(classifyBot(`Mozilla/5.0 (compatible; ${token}/1.0; +https://crawler.vendor.com/)`).crawlerId).toBe(id);
    for (const ua of [`Fake${token}/1.0`, `${token}-suffix/1.0`, `Mozilla/5.0 https://vendor.com/${token}`]) expect(classifyBot(ua).crawlerId).toBeUndefined();
    expect(getBotRules().find(rule => rule.crawlerId === id).aiEligible).toBe(id !== 'kagibot');
  });
  it('never recognizes signed ChatGPT Agent from a claimed UA alone', () => expect(classifyBot('ChatGPT Agent/1.0').crawlerId).toBeUndefined());
  it('keeps Kagi manual evidence separate from automated refresh', async () => {
    const source = getRangeSources().find(source => source.id === 'kagi-manual');
    const baseline = getRangeBaselines()['kagi-manual'];
    const now = Date.parse(baseline.observedAt) + 1000;
    const evidence = { Kagibot: { prefixes: baseline.content.prefixes, retrievedAt: baseline.observedAt, version: baseline.content.version, source: source.url } };
    expect(verifyBotIpEvidence('216.18.205.234', 'Kagibot', 'Kagibot/1.0', new Date(now).toISOString(), evidence, { now }).status).toBe('verified_range');
    const fetcher = vi.fn(); await expect(checkRangeSource(source, undefined, { fetcher })).rejects.toThrow('manual_review_required'); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['kimi.ai','www.kimi.ai','kimi.moonshot.cn','chat.deepseek.com','qianwen.com','chat.qwen.ai','yuanbao.tencent.com','ima.qq.com','metaso.cn','cue.im'])('classifies the reviewed exact host %s', host => expect(classifyEntrySource({ referrer: host }).channel).toBe('AI 搜索引荐'));
  it.each(['qq.com','tencent.com','feishu.cn','aily.feishu.cn','api.deepseek.com','deepseek.com','docs.qwen.ai','evil.kimi.com','kimi.com.attacker.com','workbuddy.tencent.com'])('does not widen an AI referral to %s', host => expect(classifyEntrySource({ referrer: host }).channel).toBe('其他引荐'));
  it('applies a published referral change to both JavaScript and SQL consumers', () => {
    const rule = h.catalog.payload.referrals.find(rule => rule.host === 'kimi.ai'); rule.enabled = false;
    expect(referralForHost('kimi.ai')).toBeUndefined(); expect(channelFilterColumn()).not.toContain("='kimi.ai'");
    rule.enabled = true; expect(referralForHost('kimi.ai').platformId).toBe('kimi'); expect(channelFilterColumn()).toContain("='kimi.ai'");
    expect(channelFilterColumn()).not.toContain("='.qq.com'");
  });
  it('keeps shared traditional-search platforms out of crawler-to-AI-referral ratios', () => {
    expect(platformForReferral('so.com')).toMatchObject({ id: '360', ratio: false });
    expect(platformForReferral('www.n.cn')).toMatchObject({ id: '360', ratio: false });
    expect(platformSupportsReferralRatio('360')).toBe(false);
    expect(platformSupportsReferralRatio('openai')).toBe(true);
  });
  it('keeps product labels and confirmed product bindings when a catalog is bound', () => {
    expect(referralPlatformName(referralForHost('chatgpt.com'))).toBe('ChatGPT');
    expect(referralPlatformName(referralForHost('claude.ai'))).toBe('Claude');
    expect(referralPlatformName(referralForHost('doubao.com'))).toBe('豆包');
    for (const id of ['chatgpt','claude','perplexity']) {
      const product = h.catalog.payload.products.find(product => product.id === id);
      expect(product.supportStatus).toBe('confirmed');
      expect(product.identityIds.length).toBeGreaterThan(0);
    }
  });

});
