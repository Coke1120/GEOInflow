import { describe, expect, it } from 'vitest';
import { validateAiAnswer } from './answer';
import type { AiFactsContext } from './facts-contracts';
import { prepareAiPrompt } from './prompt';

const id = '00000000-0000-4000-8000-000000000001';
const context: AiFactsContext = {
  protocolVersion: 1,
  id,
  website: { id, name: '测试演示网站', domain: null },
  space: { kind: 'personal', id },
  websiteEpoch: id,
  currentRange: { startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-10-03T23:59:59.999Z' },
  previousRange: { startAt: '2026-09-28T00:00:00.000Z', endAt: '2026-09-30T23:59:59.999Z' },
  timeZone: 'UTC',
  generatedAt: '2026-10-04T00:00:00.000Z',
  metricVersion: 'liekan-ai-facts-v1',
  promptVersion: 'liekan-ai-prompt-v1',
  coverage: 'unverified',
  rangeNotes: {
    originalEndAt: '2026-10-03T23:59:59.999Z',
    endClamped: false,
    currentDayIncomplete: false,
  },
  sourceStates: {
    human: 'empty',
    logs: 'not_connected',
    catalog: 'not_connected',
    goals: 'not_connected',
    aiReferrals: 'empty',
  },
  businessProfile: { state: 'unconfigured', value: null },
  metrics: [],
  facts: [],
};
const connectionConfig = {
  provider: 'custom',
  protocol: 'openai-chat',
  baseUrl: 'https://models.example.com/v1',
  model: 'test-demo',
};
const answer = {
  summary: '历史测试演示。',
  observations: [],
  possibleCauses: [],
  suggestions: [],
  limitations: [],
};
describe('AI actual serialized prompt budget', () => {
  it('keeps vague questions in the complete JSON contract with current fact references', () => {
    const current: AiFactsContext = {
      ...context,
      facts: [
        {
          id: 'pages',
          label: '当前页面',
          state: 'available',
          data: {
            total: 1,
            omitted: 0,
            truncated: false,
            rows: [],
            scope:
              'browser paths and encoded imported AI request paths; union of current and previous periods ranked by current then previous counts; stored forms may differ; query and fragment excluded',
          },
        },
      ],
    };
    const prepared = prepareAiPrompt({
      context: current,
      question: '试试',
      history: [],
      connectionConfig,
    });
    const payload = JSON.parse(prepared.prompt);
    expect(payload.question).toBe('试试');
    expect(prepared.system).toContain('意图不明确');
    expect(prepared.system).toContain('JSON');
    expect(
      validateAiAnswer(payload.responseExample, prepared.allowedContexts).observations[0].refs,
    ).toEqual([{ contextId: current.id, factId: 'pages' }]);
  });
  it('provides a valid complete example when no facts are available', () => {
    const prepared = prepareAiPrompt({ context, question: '你好', history: [], connectionConfig });
    const example = JSON.parse(prepared.prompt).responseExample;
    expect(validateAiAnswer(example, prepared.allowedContexts).observations).toEqual([]);
    expect(Object.keys(example)).toEqual([
      'summary',
      'observations',
      'possibleCauses',
      'suggestions',
      'limitations',
    ]);
  });
  it('sends only six complete authorized turns and bases references on their actual contexts', () => {
    const history = Array.from({ length: 8 }, (_, n) => ({
      state: 'completed' as const,
      question: `q${n}`,
      answer,
      context: { ...context, id: `00000000-0000-4000-8000-${String(n + 10).padStart(12, '0')}` },
    }));
    history.push({ ...history[0], state: 'failed' as any });
    const result = prepareAiPrompt({
      context,
      question: '分析当前访问',
      history,
      connectionConfig: {
        provider: 'kimi',
        protocol: 'openai-chat',
        baseUrl: 'https://api.moonshot.cn/v1',
        model: 'kimi-k3',
      },
    });
    const payload = JSON.parse(result.prompt);
    expect(payload.history).toHaveLength(6);
    expect(payload.history[0].question).toBe('q2');
    expect(result.allowedContexts.map(c => c.id)).toEqual([
      id,
      ...history.slice(2, 8).map(h => h.context.id),
    ]);
  });
  it('drops oldest whole history before data rows and enforces UTF-8 plus token headroom', () => {
    const history = Array.from({ length: 6 }, (_, n) => ({
      state: 'completed' as const,
      question: '历史中文'.repeat(500),
      answer,
      context: { ...context, id: `00000000-0000-4000-8000-${String(n + 10).padStart(12, '0')}` },
    }));
    const result = prepareAiPrompt({
      context,
      question: '问题保持完整',
      history,
      connectionConfig,
    });
    expect(result.inputBytes).toBeLessThanOrEqual(32768);
    expect(result.estimatedInputTokens + 2048).toBeLessThanOrEqual(Math.floor(16384 * 0.9));
    expect(JSON.parse(result.prompt).question).toBe('问题保持完整');
    expect(result.trimmed.historyTurns).toBeGreaterThan(0);
    expect(() =>
      prepareAiPrompt({ context, question: '中'.repeat(6000), history: [], connectionConfig }),
    ).toThrow();
  });
});
it('trims whole samples before whole TopN rows and preserves full aggregates and original question', () => {
  const large: AiFactsContext = {
    ...context,
    metrics: [
      { key: 'visitors', label: '人类访客', value: 4, state: 'available', changePercent: null },
    ],
    facts: [
      {
        id: 'log-errors',
        label: 'test-demo',
        state: 'available',
        data: {
          total: 100,
          omitted: 80,
          truncated: true,
          requests: 100,
          previousRequests: 0,
          current: { requests: 100, errors403: 100, errors404: 0, errors5xx: 0 },
          previous: { requests: 0, errors403: 0, errors404: 0, errors5xx: 0 },
          changePercent: null,
          paths: Array.from({ length: 20 }, (_, n) => ({
            path: `/test-demo/${n}/${'a'.repeat(420)}`,
            statusGroup: '403' as const,
            requests: 1,
          })),
          samples: Array.from({ length: 20 }, (_, n) => ({
            time: '2026-10-02T00:00:00.000Z',
            path: `/test-demo/${n}/${'a'.repeat(420)}`,
            status: 403,
            bot: 'test-demo',
          })),
          sampleTotal: 100,
          samplesOmitted: 80,
          samplesTruncated: true,
          sampleMethod: 'latest_by_created_at_desc_id_desc',
          scope:
            'imported logs: HTTP 403, 404 and 500–599; current and previous aggregate counts; paths and latest samples from current period; coverage unverified',
        },
      },
      {
        id: 'pages',
        label: 'test-demo',
        state: 'available',
        data: {
          total: 200,
          omitted: 180,
          truncated: true,
          rows: Array.from({ length: 20 }, (_, n) => ({
            path: `/test-demo/${n}/${'b'.repeat(420)}`,
            humanPageviews: 10,
            previousHumanPageviews: 0,
            aiRequests: 1,
            previousAiRequests: 0,
          })),
          scope:
            'browser paths and encoded imported AI request paths; union of current and previous periods ranked by current then previous counts; stored forms may differ; query and fragment excluded',
        },
      },
    ],
  };
  const history = Array.from({ length: 6 }, (_, n) => ({
    state: 'completed',
    question: 'test-demo-history',
    answer,
    context: { ...context, id: `00000000-0000-4000-8000-${String(n + 10).padStart(12, '0')}` },
  }));
  const result = prepareAiPrompt({
    context: large,
    question: '保留完整问题',
    history,
    connectionConfig,
  });
  expect(result.trimmed.historyTurns).toBe(6);
  expect(result.trimmed.logSamples).toBe(20);
  expect(result.trimmed.topRows).toBeGreaterThan(0);
  const pages = result.contextSent.facts.find(f => f.id === 'pages');
  if (pages?.id === 'pages') {
    expect(pages.data.total).toBe(200);
    expect(pages.data.omitted).toBe(200 - pages.data.rows.length);
    expect(
      pages.data.rows.every(row => row.path && row.aiRequests === 1 && row.humanPageviews === 10),
    ).toBe(true);
  }
  expect(JSON.parse(result.prompt).question).toBe('保留完整问题');
  expect(result.contextSent.metrics[0].value).toBe(4);
  expect(result.allowedContexts.map(c => c.id)).toEqual([context.id]);
  expect(large.facts[0].id === 'log-errors' && large.facts[0].data.samples.length).toBe(20);
});

it('excludes credential query values embedded in outbound website labels', () => {
  const prepared = prepareAiPrompt({
    context: {
      ...context,
      website: {
        ...context.website,
        name: 'goal /callback?access_token=canarySecretValue#private-fragment',
      },
    },
    question: 'Compare traffic',
    history: [],
    connectionConfig,
  });
  expect(prepared.prompt).not.toContain('canarySecretValue');
  expect(prepared.prompt).not.toContain('private-fragment');
});
