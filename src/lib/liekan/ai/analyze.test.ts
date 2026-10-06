// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  accept: vi.fn(),
  complete: vi.fn(),
  save: vi.fn(),
  stage: vi.fn(),
  facts: vi.fn(),
  decrypt: vi.fn(),
  model: vi.fn(),
  prepare: vi.fn(),
  emit: vi.fn(),
  load: vi.fn(),
  query: vi.fn(),
}));
vi.mock('./runs', () => ({
  acceptAiRun: mocks.accept,
  completeAiRun: mocks.complete,
  saveAiContext: mocks.save,
  setAiRunStage: mocks.stage,
}));
vi.mock('./http', () => ({
  aiRunResponse: async (_request: unknown, _actor: unknown, _handle: unknown, execute: any) => {
    await execute({ emit: mocks.emit, signal: new AbortController().signal });
    return new Response();
  },
}));
vi.mock('../upstream/ai-facts', () => ({ buildAiFactsContext: mocks.facts }));
vi.mock('../upstream/ai-db', () => ({ aiTransaction: (fn: any) => fn({ query: mocks.query }) }));
vi.mock('../upstream/ai-access', () => ({
  aiSpaceFromRow: (row: any) => ({ kind: 'personal', id: row.owner_user_id }),
}));
vi.mock('./conversations', () => ({ loadAiConversation: mocks.load }));
vi.mock('./crypto', () => ({ decryptAiKey: mocks.decrypt }));
vi.mock('./model', () => ({ callAiModel: mocks.model }));
vi.mock('./prompt', () => ({ prepareAiPrompt: mocks.prepare }));
import { analyzeAiConversation } from './analyze';
import { AiError } from './error';

const id = '00000000-0000-4000-8000-000000000001';
const actor = { id, role: 'user' };
const input = (question: string) => ({
  question,
  startAt: '2026-01-01T00:00:00.000Z',
  endAt: '2026-01-07T23:59:59.999Z',
  timezone: 'UTC',
  connectionId: id,
  expectedConfigVersion: 1,
  clientRequestId: id,
});
const connection = {
  id,
  owner_user_id: id,
  team_id: null,
  provider: 'deepseek',
  protocol: 'openai-chat',
  base_url: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  config_version: 1,
  secret_envelope: 'fixture',
  capabilities: { keyVerified: { stream: true, structuredOutput: null } },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.accept.mockReset().mockResolvedValue({ connection });
  mocks.facts
    .mockReset()
    .mockRejectedValue(new Error('Statistics must be bypassed for a pure greeting'));
  mocks.complete.mockResolvedValue({ state: 'completed', result: { summary: 'saved' } });
});

it.each(['你好', '  您好！ ', 'hello!', 'Hi', '早上好。'])(
  'answers pure greeting %s through authorized local completion without reading statistics or calling a model',
  async question => {
    await analyzeAiConversation(new Request('https://example.com'), actor, id, input(question));
    expect(mocks.accept).toHaveBeenCalledTimes(1);
    const [, , result, stats] = mocks.complete.mock.calls[0];
    expect(result.summary).toContain('你好');
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result).toMatchObject({ observations: [], metrics: [], contextId: null, actions: [] });
    expect(stats).toMatchObject({ local: true, usage: null, ttftMs: null });
    expect(mocks.emit.mock.calls.map(([name]) => name)).toEqual(['answer', 'done']);
    expect(mocks.facts).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.decrypt).not.toHaveBeenCalled();
    expect(mocks.model).not.toHaveBeenCalled();
  },
);
it.each([
  '你好，分析最近 7 天 AI 抓取',
  'hello, compare visits',
  '你好网站的数据',
  '试试',
  '分析最近 7 天的 AI 抓取趋势',
])('keeps %s on the statistics path', async question => {
  await expect(
    analyzeAiConversation(new Request('https://example.com'), actor, id, input(question)),
  ).rejects.toThrow('Statistics must be bypassed');
  expect(mocks.facts).toHaveBeenCalledTimes(1);
  expect(mocks.complete).not.toHaveBeenCalled();
  expect(mocks.emit.mock.calls[0]).toEqual([
    'stage',
    expect.objectContaining({ stage: 'preparing' }),
  ]);
});
it('preserves the admission and completion permission fences on a greeting', async () => {
  mocks.accept.mockRejectedValueOnce(new AiError('invalidated', 'fixture', 409));
  await expect(
    analyzeAiConversation(new Request('https://example.com'), actor, id, input('你好')),
  ).rejects.toMatchObject({ code: 'invalidated' });
  expect(mocks.complete).not.toHaveBeenCalled();
  mocks.complete.mockRejectedValueOnce(new AiError('cancelled', 'fixture', 499));
  await expect(
    analyzeAiConversation(new Request('https://example.com'), actor, id, input('你好')),
  ).rejects.toMatchObject({ code: 'cancelled' });
  expect(mocks.emit).not.toHaveBeenCalled();
});

it.each([false, true])(
  'uses the same verified structured capability for budget and model with structured=%s',
  async structuredOutput => {
    const context = {
      id,
      website: { id },
      websiteEpoch: id,
      sourceStates: { human: 'available' },
      metrics: [{ value: 5 }],
      facts: [],
    };
    const answer = {
      summary: '测试分析回答',
      observations: [],
      possibleCauses: [],
      suggestions: [],
      limitations: [],
    };
    const prepared = {
      system: 'fixture',
      prompt: 'fixture',
      schema: {},
      contextSent: context,
      allowedContexts: [context],
      inputBytes: 1000,
      estimatedInputTokens: 1000,
      trimmed: { historyTurns: 0, topRows: 0, logSamples: 0 },
    };
    mocks.accept.mockResolvedValue({
      connection: {
        ...connection,
        capabilities: { keyVerified: { stream: true, structuredOutput } },
      },
    });
    mocks.facts.mockResolvedValue(context);
    mocks.load.mockResolvedValue({ row: { website_epoch: id } });
    mocks.query.mockResolvedValue([]);
    mocks.prepare.mockReturnValue(prepared);
    mocks.decrypt.mockReturnValue('fixture-key');
    mocks.model.mockResolvedValue({
      text: JSON.stringify(answer),
      ttftMs: 100,
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      stream: true,
    });
    await analyzeAiConversation(
      new Request('https://example.com'),
      actor,
      id,
      input('你好，分析当前访问'),
    );
    expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ structuredOutput }));
    expect(mocks.model).toHaveBeenCalledWith(
      expect.objectContaining({
        jsonOutput: true,
        maxOutputTokens: 2048,
        schema: structuredOutput ? prepared.schema : undefined,
      }),
    );
    expect(mocks.complete).toHaveBeenCalledWith(
      actor,
      expect.anything(),
      expect.objectContaining({ summary: answer.summary, contextId: id, metrics: context.metrics }),
      expect.objectContaining({ usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 } }),
    );
  },
);
