// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { getBotRules } from '../rules/bots';
import { historyRepairEvidenceSchema } from '../contracts/history-repair';
import {
  addCounts,
  classifySuppliedUa,
  canonicalRepairTimezone,
  evidenceManifestDigest,
  emptyCounts,
  eventDecision,
  fraction,
  includedEvent,
  logDecision,
  progress,
  rulepack,
  type EventVerdict,
  type LogVerdict,
} from './model';
const pack = () =>
  rulepack({
    catalogVersion: '00000000-0000-4000-8000-000000000001',
    rulesRevision: 1,
    rules: getBotRules(),
    configuration: { mode: 'official', disabledIds: [], overrides: {}, customRules: [] },
    botCheckDisabled: false,
  });
const event = (changes: Partial<EventVerdict> = {}): EventVerdict => ({
  classification: 'unknown',
  source: 'browser',
  reasons: ['ua_unrecognized'],
  ruleVersion: 'traffic-quality-v3',
  ...changes,
});
const log = (changes: Partial<LogVerdict> = {}): LogVerdict => ({
  bot: '其他',
  vendor: '',
  botType: '其他',
  aiEligible: false,
  crawlerId: null,
  recognitionState: 'unknown',
  recognitionCandidates: [],
  verification: 'unverified',
  verificationVersion: null,
  verificationObservedAt: null,
  verificationReason: null,
  ...changes,
});
describe('history repair evidence and population invariants', () => {
  it('normalizes UUID inputs and accepts one bounded manifest confirmation mode', () => {
    const id = 'ABCDEFAB-CDEF-4ABC-ABCD-EFABABCDEFAB';
    const append = historyRepairEvidenceSchema.parse({
      action: 'append',
      actionId: id,
      runId: id,
      uploadId: id,
      expectedRevision: 1,
      sequence: 0,
      source: 'archive',
      records: [{ eventId: id, requestUserAgent: 'GPTBot/1.0' }],
    });
    expect(append.actionId).toBe(id.toLowerCase());
    expect(append.runId).toBe(id.toLowerCase());
    expect(append.uploadId).toBe(id.toLowerCase());
    expect(append.action === 'append' && append.records[0]).toMatchObject({
      eventId: id.toLowerCase(),
    });
    const finalize = {
      action: 'finalize',
      actionId: id,
      runId: id,
      uploadId: id,
      expectedRevision: 1,
      rows: 1,
      chunks: 1,
    };
    expect(
      historyRepairEvidenceSchema.safeParse({ ...finalize, manifestDigest: 'a'.repeat(64) })
        .success,
    ).toBe(true);
    expect(
      historyRepairEvidenceSchema.safeParse({ ...finalize, manifest: ['a'.repeat(64)] }).success,
    ).toBe(true);
    expect(historyRepairEvidenceSchema.safeParse(finalize).success).toBe(false);
    expect(
      historyRepairEvidenceSchema.safeParse({
        ...finalize,
        manifestDigest: 'a'.repeat(64),
        manifest: ['a'.repeat(64)],
      }).success,
    ).toBe(false);
  });
  it('uses an ordered LF-delimited streaming manifest digest', () => {
    expect(evidenceManifestDigest(['a'.repeat(64), 'b'.repeat(64)])).toBe(
      '913f9338fb6c17253f3a14816fc08d52522454bfc19a8c99538a197cfb23fb41',
    );
    expect(evidenceManifestDigest(['b'.repeat(64), 'a'.repeat(64)])).not.toBe(
      evidenceManifestDigest(['a'.repeat(64), 'b'.repeat(64)]),
    );
  });
  it('canonicalizes IANA time zones and rejects textual fixed offsets', () => {
    expect(canonicalRepairTimezone('Asia/Calcutta')).toBe('Asia/Calcutta');
    expect(canonicalRepairTimezone('Etc/UTC')).toBe('UTC');
    for (const value of ['+01:00', '-05:30', '+0100', 'Invalid/Timezone'])
      expect(() => canonicalRepairTimezone(value)).toThrow(RangeError);
    expect(canonicalRepairTimezone('America/New_York')).toBe('America/New_York');
  });
  it('never interprets a generic reason or an unsupported old version as automation', () => {
    for (const reasons of [[], ['browser_compatible'], ['ua_unrecognized'], ['bot_check_disabled']])
      expect(eventDecision(event({ reasons }), pack()).changed).toBe(false);
    expect(
      eventDecision(event({ ruleVersion: 'unreadable', reasons: ['ua_bot'] }), pack()).changed,
    ).toBe(false);
  });
  it('uses explicit original automation without attributing an identity', () => {
    const result = eventDecision(event({ reasons: ['browser_webdriver'] }), pack());
    expect(result.after.classification).toBe('automated');
    expect(result.evidence).toBe(true);
    expect(result.proof).not.toHaveProperty('crawlerId');
  });
  it('never promotes missing, legacy or server provenance with uploaded UA', () => {
    const supplied = { ...classifySuppliedUa('GPTBot/1.0', pack()), uploadId: 'file' };
    for (const source of [null, 'legacy_override', 'authenticated_server'])
      expect(eventDecision(event({ source }), pack(), supplied).changed).toBe(false);
  });
  it('retains original automation when supplied UA does not match and surfaces a conflict', () => {
    const decision = eventDecision(
      event({ classification: 'automated', reasons: ['ua_bot'] }),
      pack(),
      {
        ...classifySuppliedUa(
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          pack(),
        ),
        uploadId: 'file',
      },
    );
    expect(decision.after.classification).toBe('automated');
    expect(decision.issue).toBe('retained-automation-conflict');
  });
  it('respects an explicit detection switch and does not label negative matches human', () => {
    const disabled = { ...pack(), botCheckDisabled: true };
    expect(classifySuppliedUa('GPTBot/1.0', disabled).automated).toBe(false);
    expect(eventDecision(event({ reasons: ['ua_bot'] }), disabled).changed).toBe(false);
    expect(
      eventDecision(event(), pack(), {
        ...classifySuppliedUa(
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          pack(),
        ),
        uploadId: 'file',
      }).after.classification,
    ).toBe('unknown');
  });
  it('uses exact uploaded UA after detection is enabled while retaining unknown records without input', () => {
    const original = event({ reasons: ['bot_check_disabled'] });
    expect(eventDecision(original, pack()).after.classification).toBe('unknown');
    expect(
      eventDecision(original, pack(), {
        ...classifySuppliedUa('GPTBot/1.0', pack()),
        uploadId: 'file',
      }).after.classification,
    ).toBe('automated');
  });
  it('keeps historical network proof only on its original identity', () => {
    const rules = getBotRules();
    const original = rules.find(rule => rule.name === 'Googlebot');
    const result = logDecision(
      log({
        bot: original.name,
        crawlerId: original.crawlerId,
        verification: 'verified_dns',
        verificationVersion: 'old',
        verificationObservedAt: '2020-01-01T00:00:00Z',
      }),
      'GPTBot/1.0',
      pack(),
      { subjectId: original.crawlerId, status: 'verified_dns' },
    );
    expect(result.after.recognitionState).toBe('ambiguous');
    expect(result.after.crawlerId).toBeNull();
    expect(result.after.verification).toBe('unverified');
    expect(result.proof.originalVerificationVersion).toBe('old');
  });
  it('keeps a matching original range proof without consulting current IP ranges', () => {
    const crawler = getBotRules().find(rule => rule.name === 'GPTBot');
    const result = logDecision(
      log({
        bot: crawler.name,
        crawlerId: crawler.crawlerId,
        verification: 'verified_range',
        verificationVersion: '2019-version',
        verificationObservedAt: '2019-01-01T00:00:00Z',
      }),
      'GPTBot/1.0',
      pack(),
    );
    expect(result.after.verification).toBe('verified_range');
    expect(result.after.verificationVersion).toBe('2019-version');
  });
  it('preserves a negative truncated-UA verdict and disabled site rules', () => {
    expect(logDecision(log({ bot: 'Retained' }), 'X'.repeat(500), pack()).after.bot).toBe(
      'Retained',
    );
    expect(
      logDecision(log({ bot: 'Retained' }), 'GPTBot/1.0', {
        ...pack(),
        configuration: { mode: 'disabled' },
      }).changed,
    ).toBe(false);
  });
  it('records a product-form-only change with its fixed catalog while preserving original verification', () => {
    const current = pack();
    const original = {
      ...logDecision(log(), 'GPTBot/1.0', current).after,
      verification: 'verified_range',
      verificationVersion: 'original-range',
      verificationObservedAt: '2019-01-01T00:00:00Z',
      verificationReason: 'original-proof',
    };
    const result = logDecision(original, 'GPTBot/1.0', current, null, {
      originalVersion: '00000000-0000-4000-8000-000000000002',
      originalProductForm: 'general',
      forms: new Map([[original.crawlerId, 'workbench']]),
    });
    expect(result.after).toEqual(original);
    expect(result.changed).toBe(true);
    expect(result.productForm).toEqual({ before: 'general', after: 'workbench' });
    expect(result.proof.catalogVersion).toBe(current.catalogVersion);
  });
  it('retains the original catalog and product form when the log cannot be reclassified', () => {
    const current = pack();
    const original = logDecision(log(), 'GPTBot/1.0', current).after;
    const catalog = {
      originalVersion: '00000000-0000-4000-8000-000000000002',
      originalProductForm: 'general',
      forms: new Map([[original.crawlerId, 'workbench']]),
    };
    for (const [ua, selected] of [
      ['', current],
      ['X'.repeat(500), current],
      ['GPTBot/1.0', { ...current, botCheckDisabled: true }],
    ] as const) {
      const result = logDecision(original, ua, selected, null, catalog);
      expect(result.changed).toBe(false);
      expect(result.evidence).toBe(false);
      expect(result.issue).not.toBeNull();
      expect(result.productForm).toEqual({ before: 'general', after: 'general' });
      expect(result.proof.catalogVersion).toBe(catalog.originalVersion);
    }
  });
  it('applies browser source before all traffic policies and preserves link/pixel semantics', () => {
    for (const mode of ['standard', 'strict', 'raw'] as const)
      expect(
        includedEvent(event({ source: null }), 1, null, {
          mode,
          allowedHostnames: [],
          revision: '0',
        }),
      ).toBe(false);
    expect(
      includedEvent(event({ source: null }), 3, null, {
        mode: 'raw',
        allowedHostnames: [],
        revision: '0',
      }),
    ).toBe(true);
    expect(
      includedEvent(event({ classification: 'automated' }), 1, null, {
        mode: 'standard',
        allowedHostnames: [],
        revision: '0',
      }),
    ).toBe(false);
  });
  it('retains exact large counts and keeps readiness below completion', () => {
    const counts = addCounts(
      { ...emptyCounts(), events: '9007199254740993' },
      { processed: '9007199254740992' },
    );
    expect(counts.events).toBe('9007199254740993');
    expect(progress('preparing', counts)).toBe(94);
    expect(progress('ready', counts)).toBe(95);
    expect(progress('validating', counts)).toBe(97);
    expect(fraction('0', '0')).toBeNull();
    expect(fraction('1', '2')).toBe(0.5);
  });
});
