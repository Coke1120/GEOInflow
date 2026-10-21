// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ catalog: undefined as any }));
vi.mock('./published', () => ({ getPublishedCatalog: () => h.catalog }));
import { getBundledPublishedCatalog } from './catalog-seed';
import { applyTrustedEdgeIdentity, verifyOfficialDns } from './request-verification';
import { cloudflareCrawlerEvidence } from '../log-ingestion/crawler-evidence';
import { edgeObservation, applyEdgeCapabilities } from '../log-ingestion/edge-observation';
import { officialRuleConfiguration } from '../rules/configuration';
import { previewOfficialConversion } from '../rules/editor';
import { normalizeAutomatic, type AutomaticRecord } from '../log-ingestion/protocol';
beforeEach(() => { h.catalog = structuredClone(getBundledPublishedCatalog()); });
const record = (raw: Record<string, unknown> = {}): AutomaticRecord => ({
  id: 'request-digest', eventDigest: 'content-digest', time: new Date().toISOString(), bot: '其他', crawlerId: null,
  verification: 'unverified', crawlerEvidence: cloudflareCrawlerEvidence(raw),
} as AutomaticRecord);
const trusted = { id: 'bound-source', kind: 'cloudflare', provider_config: 'encrypted-zone-binding', provider_job_id: 'bound-job', health: { fieldCapabilities: { BotDetectionIDs: true } } };
const declaredRecord = (userAgent: string) => normalizeAutomatic('cloudflare', trusted.id, [{
  ClientRequestHost: 'site.test', ClientRequestSource: 'eyeball', ClientIP: '8.8.8.8',
  ClientRequestMethod: 'GET', ClientRequestURI: '/', ClientRequestUserAgent: userAgent,
  EdgeStartTimestamp: new Date().toISOString(), RayID: 'review-request',
  EdgeResponseStatus: 200, EdgeResponseBodyBytes: 10, BotDetectionIDs: [129220581],
}], 'site.test', 'local-test-secret').records[0];
describe('trusted edge identities', () => {
  it.each(['unverified', 'verified_range', 'verified_dns'])('retains conflicting UA and edge subjects without a canonical %s claim', previous => {
    const value = declaredRecord('ClaudeBot/1.0');
    const eventIdentity = { id: value.id, eventDigest: value.eventDigest };
    Object.assign(value, { verification: previous, verificationVersion: 'previous-proof', verificationObservedAt: '2026-10-21T00:00:00.000Z', verificationReason: 'previous-proof' });
    expect(value.crawlerId).toBe('claudebot');
    applyTrustedEdgeIdentity(value, trusted, officialRuleConfiguration());
    expect(value).toMatchObject({ ...eventIdentity, crawlerId: null, bot: '其他', vendor: '', type: '其他', aiEligible: false,
      recognitionState: 'ambiguous', recognitionCandidates: ['chatgpt-agent', 'claudebot'],
      verification: 'unverified', verificationVersion: null, verificationObservedAt: null, verificationReason: 'identity_conflict',
      identityEvidence: { method: 'edge', status: 'verified_edge', subjectId: 'chatgpt-agent', reason: 'trusted_cloudflare_identity' } });
    expect(value.identityEvidence.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('unions existing ambiguous UA candidates with the precise edge subject', () => {
    const value = declaredRecord('ClaudeBot/1.0 GPTBot/1.0');
    expect(value).toMatchObject({ crawlerId: null, recognitionState: 'ambiguous', recognitionCandidates: ['claudebot', 'gptbot'] });
    applyTrustedEdgeIdentity(value, trusted, officialRuleConfiguration());
    applyTrustedEdgeIdentity(value, trusted, officialRuleConfiguration());
    expect(value).toMatchObject({ crawlerId: null, bot: '其他', aiEligible: false, recognitionState: 'ambiguous',
      recognitionCandidates: ['chatgpt-agent', 'claudebot', 'gptbot'], verification: 'unverified', verificationReason: 'identity_conflict' });
  });
  it('keeps one canonical record when UA and edge identify the same subject', () => {
    h.catalog.payload.verificationMethods.find(item => item.id === 'chatgpt-agent-cloudflare').crawlerIds = ['claudebot'];
    const value = declaredRecord('ClaudeBot/1.0');
    const eventIdentity = { id: value.id, eventDigest: value.eventDigest };
    applyTrustedEdgeIdentity(value, trusted, officialRuleConfiguration());
    applyTrustedEdgeIdentity(value, trusted, officialRuleConfiguration());
    expect(value).toMatchObject({ ...eventIdentity, crawlerId: 'claudebot', bot: 'ClaudeBot', recognitionState: 'recognized',
      recognitionCandidates: [], verification: 'verified_edge', aiEligible: true,
      identityEvidence: { subjectId: 'claudebot', status: 'verified_edge' } });
  });
  it('keeps a disabled configuration disabled after conversion to official identities', () => {
    const value = record({ BotDetectionIDs: [129220581] });
    const preview = previewOfficialConversion({ mode: 'disabled' });
    applyTrustedEdgeIdentity(value, trusted, preview.configuration);
    expect(preview.enabled).toEqual([]);
    expect(value).toMatchObject({ crawlerId: null, verification: 'unverified' });
  });
  it('applies the signed identity type override without changing catalog eligibility', () => {
    const value = record({ BotDetectionIDs: [129220581] });
    applyTrustedEdgeIdentity(value, trusted, { mode: 'official', disabledIds: [], overrides: { 'chatgpt-agent': { type: '训练' } }, customRules: [] });
    expect(value).toMatchObject({ crawlerId: 'chatgpt-agent', type: '训练', aiEligible: true, verification: 'verified_edge' });
  });
  it('accepts only an exact published mapping on the authenticated source', () => {
    const value = record({ BotDetectionIDs: [129220581], BotTags: ['chatgpt-agent'] });
    applyTrustedEdgeIdentity(value, trusted, officialRuleConfiguration());
    expect(value).toMatchObject({ crawlerId: 'chatgpt-agent', bot: 'ChatGPT Agent', verification: 'verified_edge', aiEligible: true, identityEvidence: { method: 'edge', subjectId: 'chatgpt-agent' } });
  });
  it.each([{ BotScore: 99 }, { VerifiedBotCategory: 'AI Assistant' }, { BotTags: ['chatgpt-agent'] }, { BotDetectionIDs: ['129220581'] }, { BotDetectionIDs: [1], 'Signature-Agent': 'https://chatgpt.com' }])('never promotes generic or self-claimed evidence %j', raw => {
    const value = record(raw); applyTrustedEdgeIdentity(value, trusted, officialRuleConfiguration()); expect(value.verification).toBe('unverified');
  });
  it.each([{ ...trusted, kind: 'server' }, { ...trusted, provider_config: null }, { ...trusted, provider_job_id: null }, { ...trusted, health: { fieldCapabilities: { BotDetectionIDs: false } } }])('requires all trusted connection inputs', source => {
    const value = record({ BotDetectionIDs: [129220581] }); applyTrustedEdgeIdentity(value, source, officialRuleConfiguration()); expect(value.crawlerId).toBeNull();
  });
  it('keeps disabled rules and uninstalled fields explicit', () => {
    const value = record({ BotDetectionIDs: [129220581] });
    applyTrustedEdgeIdentity(value, trusted, { mode: 'official', disabledIds: ['chatgpt-agent'], overrides: {}, customRules: [] }); expect(value.verification).toBe('unverified');
    const fields = applyEdgeCapabilities(edgeObservation({}), { BotDetectionIDs: false, BotTags: true }).fields;
    expect(fields.BotDetectionIDs.state).toBe('unsupported'); expect(fields.BotTags.state).toBe('missing');
  });
  it('does not claim product identity when a mapping names more than one subject', () => {
    h.catalog.payload.verificationMethods.find(item => item.id === 'chatgpt-agent-cloudflare').crawlerIds.push('chatgpt-user');
    const value = record({ BotDetectionIDs: [129220581] }); applyTrustedEdgeIdentity(value, trusted, officialRuleConfiguration()); expect(value.verification).toBe('unverified');
  });
});
describe('bounded official DNS verification', () => {
  const resolver = (name = 'crawl-8-8-8-8.googlebot.com', forward = '8.8.8.8') => ({ reverse: vi.fn().mockResolvedValue([name]), resolve4: vi.fn().mockResolvedValue([forward]), resolve6: vi.fn().mockResolvedValue([]), cancel: vi.fn() });
  const check = (dns: ReturnType<typeof resolver>, ip = '8.8.8.8', time = new Date().toISOString()) => verifyOfficialDns(ip, { ...record(), crawlerId: 'googlebot', time }, h.catalog.payload.verificationMethods.find(item => item.id === 'googlebot-dns'), { resolver: dns });
  it('requires official suffix and forward equality and saves no address or PTR', async () => {
    const dns = resolver(); const result = await check(dns); expect(result.status).toBe('verified_dns');
    expect(JSON.stringify(result)).not.toContain('8.8.8.8'); expect(JSON.stringify(result)).not.toContain('googlebot.com'); expect(dns.cancel).toHaveBeenCalled();
  });
  it.each(['googlebot.com.attacker.com', 'evilgooglebot.com'])('rejects misleading PTR %s without forward lookup', async name => {
    const dns = resolver(name); expect((await check(dns)).reason).toBe('dns_suffix_mismatch'); expect(dns.resolve4).not.toHaveBeenCalled();
  });
  it('rejects reverse-only evidence and historical/private inputs', async () => {
    expect((await check(resolver(undefined, '8.8.4.4'))).reason).toBe('dns_forward_mismatch');
    const dns = resolver(); expect((await check(dns, '127.0.0.1')).status).toBe('unverified');
    expect((await check(dns, '8.8.8.8', '2020-01-01T00:00:00Z')).status).toBe('unverified'); expect(dns.reverse).not.toHaveBeenCalled();
  });
  it('cancels stalled DNS after the fixed deadline', async () => {
    vi.useFakeTimers(); try {
      const dns = resolver(); dns.reverse.mockImplementation(() => new Promise(() => {})); const pending = check(dns);
      await vi.advanceTimersByTimeAsync(1001); expect((await pending).reason).toBe('dns_timeout'); expect(dns.cancel).toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
