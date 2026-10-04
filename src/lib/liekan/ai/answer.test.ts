import { describe, expect, it } from 'vitest';
import { resolveAiActions, validateAiAnswer } from './answer';
import type { AiFactsContext } from './facts-contracts';

const id = '00000000-0000-4000-8000-000000000001',
  oldId = '00000000-0000-4000-8000-000000000002';
const context = {
  id,
  website: { id },
  currentRange: { startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-10-03T23:59:59.999Z' },
  generatedAt: '2026-10-04T00:00:00.000Z',
  facts: [{ id: 'summary', state: 'available' }],
} as AiFactsContext;
const ref = { contextId: id, factId: 'summary' };
const answer = {
  summary: '需要进一步核对访问变化。',
  observations: [{ text: '依据当前统计范围观察。', refs: [ref] }],
  possibleCauses: [],
  suggestions: [{ text: '查看日志。', refs: [ref], action: 'geo-logs' }],
  limitations: ['日志覆盖未经验证。'],
};
describe('AI answer validation', () => {
  it('permits only sent facts and registered server actions', () => {
    expect(validateAiAnswer(JSON.stringify(answer), [context])).toEqual(answer);
    expect(resolveAiActions(answer as any, context)[0].href).toContain('/geo/logs?date=range%3A');
    for (const bad of [
      { ...answer, metrics: { pv: 99 } },
      { ...answer, observations: [{ text: 'x', refs: [{ ...ref, factId: 'missing' }] }] },
      { ...answer, suggestions: [{ text: 'x', refs: [ref], action: 'javascript:alert(1)' }] },
      { ...answer, summary: '<img src="https://example.com/x">' },
      { ...answer, summary: 'https://evil.example.com' },
    ])
      expect(() => validateAiAnswer(bad, [context])).toThrow();
  });
  it('requires current references for observations and marks any authorized historical refs with original dates', () => {
    const old = { ...context, id: oldId };
    expect(() =>
      validateAiAnswer(
        { ...answer, observations: [{ text: '当前变化', refs: [{ ...ref, contextId: oldId }] }] },
        [context, old],
      ),
    ).toThrow();
    const result = validateAiAnswer(
      {
        ...answer,
        possibleCauses: [
          {
            text: '历史访问结构可能有关。',
            uncertainty: 'possible',
            refs: [{ ...ref, contextId: oldId }],
          },
        ],
      },
      [context, old],
    );
    expect(result.possibleCauses[0].refs[0]).toMatchObject({
      historical: { ...old.currentRange, asOf: old.generatedAt },
    });
    expect(() =>
      validateAiAnswer({ ...answer, possibleCauses: [{ text: '一定由抓取导致', refs: [ref] }] }, [
        context,
      ]),
    ).toThrow();
  });
  it('fails malformed, refused and oversized output without repair', () => {
    for (const bad of ['```json\n{}\n```', '{"refusal":"no"}', 'x'.repeat(32769)])
      expect(() => validateAiAnswer(bad, [context])).toThrow();
  });
});
it('rejects unqualified causes and summaries without current evidence when data is available', () => {
  expect(() =>
    validateAiAnswer(
      {
        ...answer,
        possibleCauses: [{ text: '流量一定由爬虫影响。', uncertainty: 'possible', refs: [ref] }],
      },
      [context],
    ),
  ).toThrow();
  expect(() => validateAiAnswer({ ...answer, observations: [] }, [context])).toThrow();
});

it('rejects Markdown links and images in every plaintext answer field', () => {
  for (const markup of [
    '![test-demo](/test-demo-private.png)',
    '[test-demo](//example.invalid)',
    '[test-demo](/test-demo-private)',
    '[test-demo][private-link]',
    '![one\ntwo]\n\n文字\n\n[one\ntwo]: /test-demo-private.png',
    '[one\ntwo]\n\n文字\n\n[one\ntwo]: //example.invalid',
    '[test-demo]: /test-demo-private.png\n\n![test-demo]',
    '[test-demo]: //example.invalid\n\n[test-demo]',
    '[test-demo]: /test-demo-private\n\n说明段落\n\n[test-demo][]',
    '![test-demo]\n\n说明段落\n\n[test-demo]: /test-demo-private.png',
    '[test-demo]: /test-demo-private\n\n[test-demo][test-demo]',
    '![test-demo [nested]](/test-demo-private.png)',
    '[test-demo [nested]](//example.invalid)',
  ]) {
    const variants = [
      { ...answer, summary: markup },
      { ...answer, observations: [{ text: markup, refs: [ref] }] },
      {
        ...answer,
        possibleCauses: [{ text: `可能 ${markup}`, refs: [ref], uncertainty: 'possible' }],
      },
      { ...answer, suggestions: [{ text: markup, refs: [ref] }] },
      { ...answer, limitations: [markup] },
    ];
    for (const value of variants)
      expect(() => validateAiAnswer(value, [context]), markup).toThrow();
  }
});

it('applies the 32 KiB limit again after authorized historical references gain date metadata', () => {
  const old = { ...context, id: oldId };
  const historical = { contextId: oldId, factId: 'summary' };
  const items = () =>
    Array.from({ length: 8 }, () => ({
      text: '测试演示历史可能相关。',
      refs: Array.from({ length: 12 }, () => ({ ...historical })),
    }));
  const value = {
    summary: '测试演示当前观察。',
    observations: items().map(item => ({ ...item, refs: [{ ...ref }, ...item.refs.slice(1)] })),
    possibleCauses: items().map(item => ({ ...item, uncertainty: 'possible' })),
    suggestions: items(),
    limitations: [],
  };
  expect(Buffer.byteLength(JSON.stringify(value), 'utf8')).toBeLessThanOrEqual(32768);
  expect(() => validateAiAnswer(value, [context, old])).toThrow();
});
