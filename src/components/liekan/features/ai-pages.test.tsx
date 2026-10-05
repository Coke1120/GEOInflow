import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiPages } from './AiPages';
import { featureHref } from './routes';

const id = '11111111-1111-4111-8111-111111111111';
const siteId = '22222222-2222-4222-8222-222222222222';
const connectionId = '33333333-3333-4333-8333-333333333333';
const conversationId = '44444444-4444-4444-8444-444444444444';
const runId = '55555555-5555-4555-8555-555555555555';
const mocks = vi.hoisted(() => ({
  context: null as any,
  catalog: vi.fn(),
  connections: vi.fn(),
  createConnection: vi.fn(),
  updateConnection: vi.fn(),
  deleteConnection: vi.fn(),
  createConversation: vi.fn(),
  conversation: vi.fn(),
  conversations: vi.fn(),
  messages: vi.fn(),
  contextCall: vi.fn(),
  run: vi.fn(),
  findRun: vi.fn(),
  cancel: vi.fn(),
  stream: vi.fn(),
}));
vi.mock('./context', () => ({ useFeature: () => mocks.context }));
vi.mock('@/lib/liekan/upstream/ai-client', () => ({
  aiClient: { ...mocks, context: mocks.contextCall },
  streamAiRun: mocks.stream,
  AiClientError: class extends Error {},
}));
const template = {
  id: 'deepseek',
  name: 'DeepSeek',
  provider: 'deepseek',
  protocol: 'openai-chat',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  notes: [],
  documentationUrls: ['https://api-docs.deepseek.com/'],
};
const catalog = () => ({
  module: { enabled: true },
  templates: [template],
  spaces: [{ kind: 'personal', id, name: '个人空间', canManage: true, canUse: true }],
  websites: [
    { id: siteId, name: '研究站', domain: 'research.example.com', space: { kind: 'personal', id } },
  ],
  limits: { connectionsPerSpace: 20, maxDays: 90, maxQuestionCharacters: 2000 },
});
const completed = (patch: any = {}) => ({
  protocolVersion: 1,
  id: runId,
  clientRequestId: '66666666-6666-4666-8666-666666666666',
  operation: 'analysis',
  state: 'completed',
  configVersion: 1,
  startedAt: '2026-10-04T00:00:00Z',
  error: null,
  ttftMs: null,
  latencyMs: 20,
  callAttempted: false,
  usage: null,
  ...patch,
});
const answer = {
  summary: '当前空间尚未配置可用的 AI 连接。',
  observations: [],
  possibleCauses: [],
  suggestions: [],
  limitations: ['该提示由本地规则生成，未调用模型。'],
  contextId: '77777777-7777-4777-8777-777777777777',
  origin: 'local',
};
const connection = () => ({
  id: connectionId,
  name: 'DeepSeek',
  provider: 'deepseek',
  protocol: 'openai-chat',
  baseUrl: template.baseUrl,
  model: template.model,
  enabled: true,
  isDefault: true,
  hasKey: true,
  rowVersion: 1,
  configVersion: 1,
  testState: 'connected',
  testedAt: null,
  capabilities: { keyVerified: { text: true, stream: true } },
});
function mount(page = 'ai-config') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = () => (
    <QueryClientProvider client={client}>
      <AiPages page={page} />
    </QueryClientProvider>
  );
  const result = render(view());
  return { ...result, refreshContext: () => result.rerender(view()) };
}
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mocks.context = {
    user: { id },
    query: {},
    range: { timezone: 'Asia/Shanghai' },
    href: (page: string, params: any = {}) =>
      `/liekan/${page}${Object.keys(params).length ? `?${new URLSearchParams(params)}` : ''}`,
    navigate: vi.fn(),
    notify: vi.fn(),
  };
  mocks.stream.mockResolvedValue(completed({ result: answer }));
  mocks.cancel.mockResolvedValue(completed({ state: 'cancelled' }));
  mocks.catalog.mockResolvedValue(catalog());
  mocks.connections.mockResolvedValue({ items: [] });
  mocks.conversations.mockResolvedValue({ items: [], nextCursor: null });
  mocks.messages.mockResolvedValue({ items: [], nextCursor: null });
  mocks.createConversation.mockResolvedValue({ id: conversationId, websiteId: siteId });
  mocks.conversation.mockImplementation(async (value: string) => ({
    id: value,
    websiteId: siteId,
  }));
});
describe('Liekan AI production interactions', () => {
  it('fills the provider preset and clears its write-only key after saving and reopening', async () => {
    const user = userEvent.setup();
    mocks.createConnection.mockResolvedValue(connection());
    mount();
    await user.click(await screen.findByRole('button', { name: '新建 API' }));
    expect(screen.getByLabelText('连接名称')).toHaveValue('DeepSeek');
    expect(screen.getByLabelText('API 地址')).toHaveValue(template.baseUrl);
    expect(screen.getByLabelText('模型标识')).toHaveValue(template.model);
    await user.type(screen.getByLabelText('API Key'), 'private-key-for-test');
    await user.click(screen.getByRole('button', { name: '保存 API' }));
    await waitFor(() =>
      expect(mocks.createConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'private-key-for-test',
          templateId: 'deepseek',
          space: { kind: 'personal', id },
        }),
      ),
    );
    await user.click(await screen.findByRole('button', { name: '新建 API' }));
    expect(screen.getByLabelText('API Key')).toHaveValue('');
    expect(sessionStorage.length).toBe(0);
  });
});

describe('AI scope, cancellation and recovery', () => {
  it('requires an explicit website and suggestion buttons only fill the question', async () => {
    const user = userEvent.setup();
    mount('ai-chat');
    expect(await screen.findByLabelText('分析网站')).toHaveValue('');
    expect(mocks.connections).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText('分析网站'), siteId);
    await user.click(await screen.findByRole('button', { name: '分析最近 7 天的 AI 抓取趋势' }));
    expect(screen.getByLabelText('分析问题')).toHaveValue('分析最近 7 天的 AI 抓取趋势');
    expect(mocks.stream).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText('分析模型'), 'local');
    await user.click(screen.getByRole('button', { name: '发起分析' }));
    await waitFor(() =>
      expect(mocks.stream).toHaveBeenCalledWith(
        `/liekan/ai/conversations/${conversationId}/messages`,
        expect.objectContaining({
          localOnly: true,
          expectedConfigVersion: 1,
          timezone: 'Asia/Shanghai',
          question: '分析最近 7 天的 AI 抓取趋势',
        }),
        expect.any(AbortSignal),
        expect.any(Function),
      ),
    );
    expect(mocks.stream.mock.calls[0][1]).not.toHaveProperty('connectionId');
    expect(await screen.findByText('本地规则指引 · 未调用模型')).toBeInTheDocument();
  });
  it('shows module-off and read-only permissions without issuing a model request', async () => {
    const user = userEvent.setup();
    const off = catalog();
    off.module = { enabled: false, reason: 'feature_disabled' } as any;
    mocks.catalog.mockResolvedValue(off);
    mocks.context.query = { aiSite: siteId };
    const ui = mount('ai-chat');
    expect(await screen.findByText(/实例尚未启用 AI 能力/)).toBeInTheDocument();
    expect(screen.getByLabelText('分析问题')).toBeDisabled();
    expect(mocks.connections).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
    ui.unmount();
    const read = catalog();
    read.spaces[0].canManage = false;
    read.spaces[0].canUse = false;
    mocks.catalog.mockResolvedValue(read);
    mount('ai-chat');
    expect(await screen.findByText(/当前网站所属空间为只读权限/)).toBeInTheDocument();
    expect(screen.getByLabelText('分析问题')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '新建对话' }));
    expect(mocks.stream).not.toHaveBeenCalled();
  });
  it('hides management actions from ordinary space members', async () => {
    const member = catalog();
    member.spaces[0].canManage = false;
    mocks.catalog.mockResolvedValue(member);
    mocks.connections.mockResolvedValue({ items: [connection()] });
    mount();
    expect(await screen.findByText(/你可以使用已验证的连接/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建 API' })).toBeDisabled();
    expect(await screen.findByRole('button', { name: '实时测试' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument();
  });
  it('persists cancellation before aborting the test and keeps focus until confirmation', async () => {
    const user = userEvent.setup();
    let signal: AbortSignal, resolveCancel: (value: any) => void;
    mocks.connections.mockResolvedValue({ items: [connection()] });
    mocks.stream.mockImplementation((_path, _body, inputSignal, onEvent) => {
      signal = inputSignal;
      onEvent({ type: 'started', runId });
      return new Promise(() => {});
    });
    mocks.cancel.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveCancel = resolve;
        }),
    );
    mount();
    const trigger = await screen.findByRole('button', { name: '实时测试' });
    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: '实时测试' })).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '关闭' }));
    expect(mocks.cancel).toHaveBeenCalledWith(runId);
    expect(signal.aborted).toBe(false);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await act(async () => resolveCancel(completed({ state: 'cancel_requested' })));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(signal.aborted).toBe(true);
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
  });
  it('keeps a failed cancellation visible and never claims the task stopped', async () => {
    const user = userEvent.setup();
    let signal: AbortSignal;
    mocks.connections.mockResolvedValue({ items: [connection()] });
    mocks.stream.mockImplementation((_path, _body, s, onEvent) => {
      signal = s;
      onEvent({ type: 'started', runId });
      return new Promise(() => {});
    });
    mocks.cancel.mockRejectedValue({ status: 503 });
    mount();
    await user.click(await screen.findByRole('button', { name: '实时测试' }));
    await user.keyboard('{Escape}');
    expect(await screen.findByText(/取消请求未确认/)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(signal.aborted).toBe(false);
    mocks.cancel.mockResolvedValue(completed({ state: 'cancelled' }));
    await user.click(screen.getByRole('button', { name: '关闭' }));
  });
  it('restores a request with GET only and uses the final result origin', async () => {
    sessionStorage.setItem(
      `liekan-ai:${id}:analysis:${siteId}`,
      JSON.stringify({
        clientRequestId: '66666666-6666-4666-8666-666666666666',
        runId,
        siteId,
        conversationId,
      }),
    );
    mocks.context.query = { aiSite: siteId };
    mocks.run.mockResolvedValue(completed({ result: answer }));
    mount('ai-chat');
    expect(await screen.findByText('本地规则指引 · 未调用模型')).toBeInTheDocument();
    expect(mocks.run).toHaveBeenCalledWith(runId, expect.any(AbortSignal));
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(mocks.createConversation).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(mocks.messages).toHaveBeenCalledWith(
        conversationId,
        undefined,
        expect.any(AbortSignal),
      ),
    );
  });
  it('opens the historical context reference without replacing it with current facts', async () => {
    const user = userEvent.setup(),
      contextId = answer.contextId;
    mocks.context.query = { aiSite: siteId, aiConversation: conversationId };
    mocks.messages.mockResolvedValue({
      items: [
        {
          id,
          question: '旧问题',
          result: answer,
          origin: 'local',
          state: 'completed',
          runId,
          contextId,
        },
      ],
      nextCursor: null,
    });
    mocks.contextCall.mockRejectedValue({ status: 404 });
    mount('ai-chat');
    await user.click(await screen.findByRole('button', { name: '查看生成时依据' }));
    await waitFor(() =>
      expect(mocks.contextCall).toHaveBeenCalledWith(
        conversationId,
        contextId,
        expect.any(AbortSignal),
      ),
    );
    expect(
      await within(screen.getByRole('dialog')).findByText(/资源或生成时依据不可访问/),
    ).toBeInTheDocument();
    expect(mocks.stream).not.toHaveBeenCalled();
  });
  it('keeps uncommitted stream text as plain preview and waits for a completed run', async () => {
    const user = userEvent.setup();
    mocks.context.query = { aiSite: siteId };
    mocks.connections.mockResolvedValue({ items: [connection()] });
    let finish: (value: any) => void;
    mocks.stream.mockImplementation((_p, _b, _s, event) => {
      event({ type: 'started', runId });
      event({ type: 'delta', runId, data: { text: '<script>preview</script>' } });
      event({ type: 'answer', runId, data: answer });
      return new Promise(resolve => {
        finish = resolve;
      });
    });
    mount('ai-chat');
    await user.type(await screen.findByLabelText('分析问题'), '核查网站');
    await user.click(screen.getByRole('button', { name: '发起分析' }));
    expect(await screen.findByText('<script>preview</script>')).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
    expect(screen.queryByText('本地规则指引 · 未调用模型')).not.toBeInTheDocument();
    await act(async () => finish(completed({ result: { ...answer, origin: 'provider' } })));
    expect(await screen.findByText('AI 分析 · 已校验')).toBeInTheDocument();
  });
});

describe('AI connection configuration boundaries', () => {
  it('requires a replacement key after changing the endpoint origin and omits a changed preset', async () => {
    const user = userEvent.setup();
    mocks.connections.mockResolvedValue({ items: [connection()] });
    mocks.updateConnection.mockResolvedValue(connection());
    mount();
    await user.click(await screen.findByRole('button', { name: '编辑' }));
    await user.click(screen.getByText('高级配置'));
    await user.clear(screen.getByLabelText('API 地址'));
    await user.type(screen.getByLabelText('API 地址'), 'https://gateway.example.com/v1');
    await user.click(screen.getByRole('button', { name: '保存 API' }));
    expect(await screen.findByText('请填写当前接口的 API Key。')).toBeInTheDocument();
    expect(mocks.updateConnection).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('API Key'), 'replacement-key');
    await user.click(screen.getByRole('button', { name: '保存 API' }));
    await waitFor(() =>
      expect(mocks.updateConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          id: connectionId,
          rowVersion: 1,
          baseUrl: 'https://gateway.example.com/v1',
          apiKey: 'replacement-key',
          isDefault: false,
        }),
      ),
    );
    expect(mocks.updateConnection.mock.calls[0][0]).not.toHaveProperty('templateId');
  });
  it('refreshes the real connection list after a row-version conflict while preserving the error', async () => {
    const user = userEvent.setup();
    mocks.connections.mockResolvedValue({ items: [connection()] });
    mocks.updateConnection.mockRejectedValue({ status: 409 });
    mount();
    await user.click(await screen.findByRole('button', { name: '编辑' }));
    await user.click(screen.getByRole('button', { name: '保存 API' }));
    expect(await screen.findByText('配置或网站归属已更新，请刷新后重试。')).toBeInTheDocument();
    await waitFor(() => expect(mocks.connections).toHaveBeenCalledTimes(2));
  });
  it('clears a pending write-only key when the form closes', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: '新建 API' }));
    await user.type(screen.getByLabelText('API Key'), 'temporary-private-key');
    await user.click(screen.getByRole('button', { name: '取消' }));
    await user.click(await screen.findByRole('button', { name: '新建 API' }));
    expect(screen.getByLabelText('API Key')).toHaveValue('');
    expect(sessionStorage.length).toBe(0);
  });
});

it('explicitly requests local statistics even when the space has a default model', async () => {
  const user = userEvent.setup();
  mocks.context.query = { aiSite: siteId };
  mocks.connections.mockResolvedValue({ items: [connection()] });
  mount('ai-chat');
  await user.selectOptions(await screen.findByLabelText('分析模型'), 'local');
  await user.type(screen.getByLabelText('分析问题'), '检查数据接入');
  await user.click(screen.getByRole('button', { name: '发起分析' }));
  await waitFor(() => expect(mocks.stream).toHaveBeenCalled());
  expect(mocks.stream.mock.calls[0][1]).toMatchObject({
    localOnly: true,
    expectedConfigVersion: 1,
  });
  expect(mocks.stream.mock.calls[0][1]).not.toHaveProperty('connectionId');
});

it('allows a fresh explicit attempt after a request is rejected before acceptance', async () => {
  const user = userEvent.setup();
  mocks.context.query = { aiSite: siteId };
  mocks.connections.mockResolvedValue({ items: [connection()] });
  mocks.stream.mockRejectedValue({ status: 409 });
  mount('ai-chat');
  await user.type(await screen.findByLabelText('分析问题'), '核查模型');
  await user.click(screen.getByRole('button', { name: '发起分析' }));
  expect(await screen.findByText('配置或网站归属已更新，请刷新后重试。')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '回查原任务' })).not.toBeInTheDocument();
  expect(sessionStorage.length).toBe(0);
  await user.click(screen.getByRole('button', { name: '重新填写问题' }));
  await user.click(screen.getByRole('button', { name: '发起分析' }));
  await waitFor(() => expect(mocks.stream).toHaveBeenCalledTimes(2));
  expect(mocks.stream.mock.calls[1][1].clientRequestId).not.toBe(
    mocks.stream.mock.calls[0][1].clientRequestId,
  );
});

it('restores an unknown run ID by querying its UUID without a POST replay', async () => {
  const clientRequestId = '66666666-6666-4666-8666-666666666666';
  sessionStorage.setItem(
    `liekan-ai:${id}:analysis:${siteId}`,
    JSON.stringify({ clientRequestId, siteId, conversationId }),
  );
  mocks.context.query = { aiSite: siteId };
  mocks.findRun.mockResolvedValue(completed({ result: answer }));
  mount('ai-chat');
  expect(await screen.findByText('本地规则指引 · 未调用模型')).toBeInTheDocument();
  expect(mocks.findRun).toHaveBeenCalledWith(clientRequestId, expect.any(AbortSignal));
  expect(mocks.stream).not.toHaveBeenCalled();
});

it('keeps recovery identifiers limited to safe metadata', async () => {
  const user = userEvent.setup();
  mocks.context.query = { aiSite: siteId };
  mocks.connections.mockResolvedValue({ items: [connection()] });
  mocks.stream.mockRejectedValue({ code: 'stream_incomplete' });
  mount('ai-chat');
  await user.type(await screen.findByLabelText('分析问题'), 'private-business-question');
  await user.click(screen.getByRole('button', { name: '发起分析' }));
  await waitFor(() => expect(mocks.stream).toHaveBeenCalled());
  const saved = JSON.parse(sessionStorage.getItem(`liekan-ai:${id}:analysis:${siteId}`));
  expect(Object.keys(saved).sort()).toEqual(['clientRequestId', 'conversationId', 'siteId']);
  expect(JSON.stringify(saved)).not.toContain('private-business-question');
});

it('ignores delayed stream completion after persisted cancellation', async () => {
  const user = userEvent.setup();
  let finish: (value: any) => void;
  mocks.connections.mockResolvedValue({ items: [connection()] });
  mocks.stream.mockImplementation((_p, _b, _s, event) => {
    event({ type: 'started', runId });
    return new Promise(resolve => {
      finish = resolve;
    });
  });
  mount();
  await user.click(await screen.findByRole('button', { name: '实时测试' }));
  await user.click(screen.getByRole('button', { name: '停止测试' }));
  await act(async () =>
    finish(
      completed({
        operation: 'test',
        result: { text: 'LIEKAN_OK delayed response', origin: 'provider' },
      }),
    ),
  );
  expect(screen.getByText('已取消')).toBeInTheDocument();
  expect(screen.queryByText('LIEKAN_OK delayed response')).not.toBeInTheDocument();
});

it('does not start a model call when conversation creation returns after leaving the page', async () => {
  const user = userEvent.setup();
  let create: (value: any) => void;
  mocks.context.query = { aiSite: siteId };
  mocks.connections.mockResolvedValue({ items: [connection()] });
  mocks.createConversation.mockImplementation(
    () =>
      new Promise(resolve => {
        create = resolve;
      }),
  );
  const ui = mount('ai-chat');
  await user.type(await screen.findByLabelText('分析问题'), '核查增长');
  await user.click(screen.getByRole('button', { name: '发起分析' }));
  await waitFor(() => expect(mocks.createConversation).toHaveBeenCalled());
  ui.unmount();
  await act(async () => create({ id: conversationId, websiteId: siteId }));
  expect(mocks.stream).not.toHaveBeenCalled();
});

it('shows the persisted snapshot clipping counts and actual model configuration', async () => {
  const user = userEvent.setup();
  mocks.context.query = { aiSite: siteId, aiConversation: conversationId };
  mocks.messages.mockResolvedValue({
    items: [{ id, question: '旧问题', result: answer, origin: 'local', state: 'completed', runId }],
    nextCursor: null,
  });
  mocks.contextCall.mockResolvedValue({
    expiresAt: '2026-11-03T00:00:00Z',
    facts: {
      website: { name: '研究站' },
      generatedAt: '2026-10-03T00:00:00Z',
      currentRange: { startAt: '2026-09-27T00:00:00Z', endAt: '2026-10-03T00:00:00Z' },
      timeZone: 'Asia/Shanghai',
      rangeNotes: {},
      sourceStates: { human: 'available' },
      facts: [],
      inputBudget: {
        trimmed: { historyTurns: 2, logSamples: 3, topRows: 4 },
        bytes: 512,
        tokenUpperBound: 256,
      },
      modelConfiguration: { model: 'deepseek-flash', provider: 'deepseek', configVersion: 3 },
    },
  });
  mount('ai-chat');
  await user.click(await screen.findByRole('button', { name: '查看生成时依据' }));
  expect(await screen.findByText('历史轮次 2 · 日志样本 3 · 排名记录 4')).toBeInTheDocument();
  expect(screen.getByText('deepseek-flash · 配置版本 3')).toBeInTheDocument();
});

it('explains an expired recovered run and allows a new conversation', async () => {
  sessionStorage.setItem(
    `liekan-ai:${id}:analysis:${siteId}`,
    JSON.stringify({
      clientRequestId: '66666666-6666-4666-8666-666666666666',
      runId,
      siteId,
      conversationId,
    }),
  );
  mocks.context.query = { aiSite: siteId };
  mocks.run.mockRejectedValue({ status: 404 });
  mount('ai-chat');
  expect(await screen.findByText(/资源或生成时依据不可访问/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '回查原任务' })).not.toBeInTheDocument();
  expect(mocks.stream).not.toHaveBeenCalled();
  expect(sessionStorage.length).toBe(0);
});

describe('AI call disclosure and test evidence', () => {
  it('identifies the supplier, model and data sent before analysis and switches to zero-call guidance', async () => {
    const user = userEvent.setup();
    mocks.context.query = { aiSite: siteId };
    const data = catalog();
    data.templates[0] = { ...template, contextWindow: 32000 } as any;
    mocks.catalog.mockResolvedValue(data);
    mocks.connections.mockResolvedValue({ items: [connection()] });
    mount('ai-chat');
    const disclosure = await screen.findByRole('region', { name: '分析调用说明' });
    await waitFor(() => expect(disclosure).toHaveTextContent('供应商：DeepSeek'));
    expect(disclosure).toHaveTextContent('模型：deepseek-flash');
    expect(disclosure).toHaveTextContent('32,000 Token');
    expect(disclosure).toHaveTextContent('来源：匹配模型模板的应用预算');
    expect(disclosure).toHaveTextContent('脱敏汇总、有限样本、本次问题与最多 6 轮历史');
    expect(disclosure).toHaveTextContent('请勿输入凭据、密钥或个人资料');
    await user.selectOptions(screen.getByLabelText('分析模型'), 'local');
    expect(disclosure).toHaveTextContent('本地统计指引 · 0 次供应商调用');
    expect(disclosure).not.toHaveTextContent('将外发');
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it('shows a conservative application window for custom parameters and unmatched models', async () => {
    const user = userEvent.setup();
    const data = catalog();
    data.templates = [
      { ...template, contextWindow: 32000 },
      {
        ...template,
        id: 'custom',
        provider: 'custom',
        name: '自定义兼容接口',
        baseUrl: '',
        model: '',
        contextWindow: 1000000,
      },
    ] as any;
    mocks.catalog.mockResolvedValue(data);
    mount();
    await user.click(await screen.findByRole('button', { name: '新建 API' }));
    expect(screen.getByText('32,000 Token · 来源：匹配模型模板的应用预算')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /自定义兼容接口/ }));
    expect(screen.getByText('16,384 Token · 来源：应用保守估算')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /DeepSeek/ }));
    await user.clear(screen.getByLabelText('模型标识'));
    await user.type(screen.getByLabelText('模型标识'), 'other-model');
    expect(screen.getByText('16,384 Token · 来源：应用保守估算')).toBeInTheDocument();
  });

  it('renders real latest-call timestamps and the safe error classification', async () => {
    const user = userEvent.setup();
    mocks.connections.mockResolvedValue({
      items: [
        {
          ...connection(),
          lastCall: {
            operation: 'test',
            state: 'failed',
            createdAt: '2026-10-04T00:00:00Z',
            completedAt: '2026-10-04T00:00:03Z',
            errorCode: 'credentials',
          },
        },
      ],
    });
    mount();
    await user.click(await screen.findByText('最近调用'));
    expect(screen.getByText(/连接测试 · 未完成 · 开始/)).toHaveTextContent('2026/10/4 08:00:00');
    expect(screen.getByText(/连接测试 · 未完成 · 开始/)).toHaveTextContent('2026/10/4 08:00:03');
    expect(screen.getByText(/连接测试 · 未完成 · 开始/)).toHaveTextContent('AI 凭证或模型权限无效');
    expect(screen.queryByText(/耗时未知/)).not.toBeInTheDocument();
  });

  it('records bounded controlled test stages and displays safe provider response metadata', async () => {
    const user = userEvent.setup();
    let event: (value: any) => void, finish: (value: any) => void;
    mocks.connections.mockResolvedValue({ items: [connection()] });
    mocks.stream.mockImplementation((_p, _b, _s, callback) => {
      event = callback;
      return new Promise(resolve => {
        finish = resolve;
      });
    });
    mount();
    await user.click(await screen.findByRole('button', { name: '实时测试' }));
    const modal = screen.getByRole('dialog', { name: '实时测试' });
    expect(modal.querySelector('[data-ai-run-state="submitting"]')).toBeInTheDocument();
    await act(async () => event({ type: 'started', runId }));
    expect(modal.querySelector('[data-ai-run-state="accepted"]')).toBeInTheDocument();
    expect(within(modal).getByText(runId)).toBeInTheDocument();
    const phases = within(modal).getByRole('list', { name: '连接检查阶段' });
    expect(
      within(phases)
        .getAllByRole('listitem')
        .map(row => row.querySelector('strong').textContent),
    ).toEqual(['配置检查', '发送请求', '首次文本', '接收完成']);
    await act(async () => {
      for (let i = 0; i < 80; i++)
        event({
          type: 'stage',
          runId,
          data: { stage: 'calling', label: 'untrusted-label-secret', text: 'private-body' },
        });
      event({ type: 'stage', runId, data: { stage: 'first_text' } });
      event({ type: 'delta', runId, data: { text: 'unvalidated-provider-preview' } });
    });
    const logs = within(modal).getByRole('list', { name: '测试事件记录' });
    expect(within(logs).getAllByRole('listitem').length).toBeLessThanOrEqual(64);
    expect(logs).toHaveTextContent('首次文本可展示');
    expect(logs).not.toHaveTextContent('private-body');
    expect(logs).not.toHaveTextContent('untrusted-label-secret');
    expect(logs).not.toHaveTextContent('unvalidated-provider-preview');
    const saved = JSON.parse(sessionStorage.getItem(`liekan-ai:${id}:test:${connectionId}`));
    expect(Object.keys(saved).sort()).toEqual(['clientRequestId', 'runId']);
    await act(async () =>
      finish(
        completed({
          operation: 'test',
          callAttempted: true,
          result: {
            text: 'LIEKAN_OK',
            origin: 'provider',
            providerResponse: { status: 200, requestId: 'req-safe-id' },
          },
        }),
      ),
    );
    expect(within(modal).getByText('200')).toBeInTheDocument();
    expect(within(modal).getByText('req-safe-id')).toBeInTheDocument();
    expect(within(modal).getByText('不适用')).toBeInTheDocument();
    expect(logs).toHaveTextContent('接收完成并通过校验');
  });
});

it('prioritizes the server connection window and region over the catalog estimate', async () => {
  const data = catalog();
  data.templates[0] = { ...template, contextWindow: 32000 } as any;
  mocks.catalog.mockResolvedValue(data);
  const row = {
    ...connection(),
    region: '北京',
    contextWindow: 65536,
    contextWindowSource: 'provider_documented',
  };
  mocks.connections.mockResolvedValue({ items: [row] });
  const config = mount();
  expect(await screen.findByText('地域：北京')).toBeInTheDocument();
  expect(screen.getByText(/65,536 Token · 来源：供应商文档/)).toBeInTheDocument();
  config.unmount();
  mocks.context.query = { aiSite: siteId };
  mount('ai-chat');
  const disclosure = await screen.findByRole('region', { name: '分析调用说明' });
  await waitFor(() => expect(disclosure).toHaveTextContent('65,536 Token · 来源：供应商文档'));
  expect(mocks.stream).not.toHaveBeenCalled();
});

it('shows unknown supplier metadata until a failed original task is explicitly queried', async () => {
  const user = userEvent.setup();
  mocks.connections.mockResolvedValue({ items: [connection()] });
  mocks.stream.mockImplementation((_p, _b, _s, event) => {
    event({ type: 'started', runId });
    return Promise.reject({ code: 'stream_incomplete' });
  });
  mocks.run.mockResolvedValue(
    completed({
      state: 'failed',
      operation: 'test',
      error: { code: 'credentials' },
      result: { providerResponse: { status: 401, requestId: null } },
    }),
  );
  mount();
  expect(await screen.findByText('地域：未知')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '实时测试' }));
  const modal = screen.getByRole('dialog', { name: '实时测试' });
  expect(within(modal).getByText('供应商状态码').nextElementSibling).toHaveTextContent('未知');
  expect(within(modal).getByText('供应商请求 ID').nextElementSibling).toHaveTextContent('未知');
  await user.click(await within(modal).findByRole('button', { name: '回查原任务' }));
  expect(await within(modal).findByText('401')).toBeInTheDocument();
  expect(within(modal).getByText('供应商请求 ID').nextElementSibling).toHaveTextContent('未知');
  expect(within(modal).getByText('AI 凭证或模型权限无效，请检查后重试。')).toBeInTheDocument();
  expect(mocks.run).toHaveBeenCalledWith(runId, expect.any(AbortSignal));
  expect(mocks.stream).toHaveBeenCalledTimes(1);
});

it('distinguishes an HTTP response from a completed text test', async () => {
  const user = userEvent.setup();
  mocks.connections.mockResolvedValue({ items: [connection()] });
  mocks.stream.mockResolvedValue(
    completed({
      state: 'failed',
      operation: 'test',
      callAttempted: true,
      error: { code: 'test_incomplete' },
      result: { providerResponse: { status: 200, requestId: 'req-incomplete-test' } },
    }),
  );
  mount();
  await user.click(await screen.findByRole('button', { name: '实时测试' }));
  const modal = screen.getByRole('dialog', { name: '实时测试' });
  expect(
    await within(modal).findByText('收到响应，文本测试未完成。请检查模型输出后重新测试。'),
  ).toBeInTheDocument();
  expect(within(modal).getByText('200')).toBeInTheDocument();
  expect(within(modal).getByText('req-incomplete-test')).toBeInTheDocument();
  expect(within(modal).getByText('未完成')).toBeInTheDocument();
  expect(within(modal).queryByText('已校验的真实返回')).not.toBeInTheDocument();
  expect(within(modal).getByRole('button', { name: '重新测试，发起新调用' })).toBeEnabled();
});

const nextConversationId = '88888888-8888-4888-8888-888888888888';
function routeChat() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = () => (
    <QueryClientProvider client={client}>
      <AiPages page="ai-chat" />
    </QueryClientProvider>
  );
  const ui = render(page());
  return {
    ...ui,
    client,
    route: (conversation: string, website: string = siteId) => {
      mocks.context = {
        ...mocks.context,
        query: { aiSite: website, ...(conversation ? { aiConversation: conversation } : {}) },
      };
      ui.rerender(page());
    },
  };
}
function historyByConversation() {
  mocks.messages.mockImplementation(async (value: string) => ({
    items: [
      {
        id: value,
        question: value === conversationId ? 'conversation A question' : 'conversation B question',
        result: answer,
        origin: 'local',
        state: 'completed',
        runId,
      },
    ],
    nextCursor: null,
  }));
}

describe('same-site conversation routing', () => {
  it('follows browser history before the next submission and closes the old reference', async () => {
    const user = userEvent.setup();
    mocks.context.query = { aiSite: siteId, aiConversation: conversationId };
    mocks.connections.mockResolvedValue({ items: [connection()] });
    historyByConversation();
    mocks.contextCall.mockResolvedValue({
      facts: {
        website: { name: '研究站' },
        generatedAt: '2026-10-04T00:00:00Z',
        currentRange: { startAt: '2026-09-28T00:00:00Z', endAt: '2026-10-04T00:00:00Z' },
        timeZone: 'Asia/Shanghai',
        rangeNotes: {},
        sourceStates: {},
        facts: [],
      },
    });
    const ui = routeChat();
    expect(await screen.findByText('conversation A question')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '查看生成时依据' }));
    expect(screen.getByRole('dialog', { name: '生成时依据' })).toBeInTheDocument();
    ui.route(nextConversationId);
    expect(await screen.findByText('conversation B question')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('conversation A question')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('分析问题'), 'new question on B');
    await user.click(screen.getByRole('button', { name: '发起分析' }));
    await waitFor(() => expect(mocks.stream).toHaveBeenCalled());
    expect(mocks.stream.mock.calls[0][0]).toBe(
      `/liekan/ai/conversations/${nextConversationId}/messages`,
    );
    ui.route(conversationId);
    expect(await screen.findByText('conversation A question')).toBeInTheDocument();
    expect(screen.queryByText('new question on B')).not.toBeInTheDocument();
    expect(mocks.createConversation).not.toHaveBeenCalled();
  });

  it('waits for persisted cancellation before switching and ignores the old stream completion', async () => {
    const user = userEvent.setup();
    let signal: AbortSignal, finish: (value: any) => void, cancel: (value: any) => void;
    mocks.context.query = { aiSite: siteId, aiConversation: conversationId };
    mocks.connections.mockResolvedValue({ items: [connection()] });
    historyByConversation();
    mocks.stream.mockImplementation((_p, _b, s, event) => {
      signal = s;
      event({ type: 'started', runId });
      return new Promise(resolve => {
        finish = resolve;
      });
    });
    mocks.cancel.mockImplementation(
      () =>
        new Promise(resolve => {
          cancel = resolve;
        }),
    );
    const ui = routeChat();
    await user.type(await screen.findByLabelText('分析问题'), 'active A question');
    await user.click(screen.getByRole('button', { name: '发起分析' }));
    ui.route(nextConversationId);
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith(runId));
    expect(signal.aborted).toBe(false);
    expect(screen.getByLabelText('分析问题')).toBeDisabled();
    expect(mocks.messages).not.toHaveBeenCalledWith(
      nextConversationId,
      undefined,
      expect.any(AbortSignal),
    );
    await act(async () => cancel(completed({ state: 'cancel_requested' })));
    expect(await screen.findByText('conversation B question')).toBeInTheDocument();
    expect(signal.aborted).toBe(true);
    await act(async () =>
      finish(completed({ result: { ...answer, summary: 'late answer from A' } })),
    );
    expect(screen.queryByText('late answer from A')).not.toBeInTheDocument();
    expect(screen.getByLabelText('分析问题')).toBeEnabled();
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
  });

  it('blocks submissions after failed route cancellation and switches only after a confirmed retry', async () => {
    const user = userEvent.setup();
    mocks.context.query = { aiSite: siteId, aiConversation: conversationId };
    mocks.connections.mockResolvedValue({ items: [connection()] });
    historyByConversation();
    mocks.stream.mockImplementation((_p, _b, _s, event) => {
      event({ type: 'started', runId });
      return new Promise(() => {});
    });
    mocks.cancel.mockRejectedValue({ status: 503 });
    const ui = routeChat();
    await user.type(await screen.findByLabelText('分析问题'), 'active A question');
    await user.click(screen.getByRole('button', { name: '发起分析' }));
    ui.route(nextConversationId);
    expect(await screen.findByText(/取消请求未确认/)).toBeInTheDocument();
    expect(screen.getByLabelText('分析问题')).toBeDisabled();
    expect(screen.queryByText('conversation B question')).not.toBeInTheDocument();
    expect(mocks.stream).toHaveBeenCalledTimes(1);
    mocks.cancel.mockResolvedValue(completed({ state: 'cancelled' }));
    await user.click(screen.getByRole('button', { name: '重试切换对话' }));
    expect(await screen.findByText('conversation B question')).toBeInTheDocument();
    expect(screen.getByLabelText('分析问题')).toBeEnabled();
    expect(mocks.cancel).toHaveBeenCalledTimes(2);
  });

  it('keeps an explicit URL conversation when an old recovered GET finishes late', async () => {
    let recovered: (value: any) => void;
    sessionStorage.setItem(
      `liekan-ai:${id}:analysis:${siteId}`,
      JSON.stringify({
        clientRequestId: '66666666-6666-4666-8666-666666666666',
        runId,
        siteId,
        conversationId,
      }),
    );
    mocks.context.query = { aiSite: siteId, aiConversation: nextConversationId };
    mocks.run.mockImplementation(
      () =>
        new Promise(resolve => {
          recovered = resolve;
        }),
    );
    historyByConversation();
    routeChat();
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith(runId));
    await act(async () =>
      recovered(completed({ result: { ...answer, summary: 'late recovered A' } })),
    );
    expect(await screen.findByText('conversation B question')).toBeInTheDocument();
    expect(screen.queryByText('conversation A question')).not.toBeInTheDocument();
    expect(screen.queryByText('late recovered A')).not.toBeInTheDocument();
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it('does not post to a newly created conversation after the URL selected another one', async () => {
    const user = userEvent.setup();
    let created: (value: any) => void;
    mocks.context.query = { aiSite: siteId };
    mocks.connections.mockResolvedValue({ items: [connection()] });
    mocks.createConversation.mockImplementation(
      () =>
        new Promise(resolve => {
          created = resolve;
        }),
    );
    historyByConversation();
    const ui = routeChat();
    await user.type(await screen.findByLabelText('分析问题'), 'question awaiting a conversation');
    await user.click(screen.getByRole('button', { name: '发起分析' }));
    await waitFor(() => expect(mocks.createConversation).toHaveBeenCalled());
    ui.route(nextConversationId);
    expect(await screen.findByText('conversation B question')).toBeInTheDocument();
    await act(async () => created({ id: conversationId, websiteId: siteId }));
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(mocks.context.navigate).not.toHaveBeenCalledWith('ai-chat', {
      aiSite: siteId,
      aiConversation: conversationId,
    });
  });

  it('acknowledges internal navigation without clearing the new draft or repeating cancellation', async () => {
    const user = userEvent.setup();
    mocks.context.query = { aiSite: siteId, aiConversation: conversationId };
    mocks.connections.mockResolvedValue({ items: [connection()] });
    mocks.conversations.mockResolvedValue({
      items: [{ id: nextConversationId, title: '历史 B', updatedAt: '2026-10-04T00:00:00Z' }],
      nextCursor: null,
    });
    historyByConversation();
    const ui = routeChat();
    expect(await screen.findByText('conversation A question')).toBeInTheDocument();
    await user.click(screen.getByText('我的历史对话'));
    await user.click(screen.getByRole('button', { name: /历史 B ·/ }));
    expect(await screen.findByText('conversation B question')).toBeInTheDocument();
    await user.type(screen.getByLabelText('分析问题'), 'draft in B');
    ui.route(nextConversationId);
    expect(screen.getByLabelText('分析问题')).toHaveValue('draft in B');
    expect(mocks.context.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
  });
});

it('keeps the latest browser target when history moves again during cancellation', async () => {
  const user = userEvent.setup();
  let cancel: (value: any) => void;
  mocks.context.query = { aiSite: siteId, aiConversation: conversationId };
  mocks.connections.mockResolvedValue({ items: [connection()] });
  historyByConversation();
  mocks.stream.mockImplementation((_p, _b, _s, event) => {
    event({ type: 'started', runId });
    return new Promise(() => {});
  });
  mocks.cancel.mockImplementation(
    () =>
      new Promise(resolve => {
        cancel = resolve;
      }),
  );
  const ui = routeChat();
  await user.type(await screen.findByLabelText('分析问题'), 'active A question');
  await user.click(screen.getByRole('button', { name: '发起分析' }));
  ui.route(nextConversationId);
  await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith(runId));
  ui.route(conversationId);
  await act(async () => cancel(completed({ state: 'cancel_requested' })));
  expect(await screen.findByText('conversation A question')).toBeInTheDocument();
  expect(screen.queryByText('conversation B question')).not.toBeInTheDocument();
  expect(screen.getByLabelText('分析问题')).toBeEnabled();
  expect(mocks.cancel).toHaveBeenCalledTimes(1);
});

it('keeps a newly selected conversation while internal URL navigation is being acknowledged', async () => {
  const user = userEvent.setup();
  mocks.context.query = { aiSite: siteId, aiConversation: conversationId };
  mocks.connections.mockResolvedValue({ items: [connection()] });
  mocks.conversations.mockResolvedValue({
    items: [{ id: nextConversationId, title: '历史 B', updatedAt: '2026-10-04T00:00:00Z' }],
    nextCursor: null,
  });
  historyByConversation();
  mocks.stream.mockImplementation((_p, _b, _s, event) => {
    event({ type: 'started', runId });
    return new Promise(() => {});
  });
  const ui = routeChat();
  expect(await screen.findByText('conversation A question')).toBeInTheDocument();
  await user.click(screen.getByText('我的历史对话'));
  await user.click(screen.getByRole('button', { name: /历史 B ·/ }));
  expect(await screen.findByText('conversation B question')).toBeInTheDocument();
  await user.type(screen.getByLabelText('分析问题'), 'new B question');
  await user.click(screen.getByRole('button', { name: '发起分析' }));
  await waitFor(() => expect(mocks.stream).toHaveBeenCalledTimes(1));
  expect(mocks.stream.mock.calls[0][0]).toBe(
    `/liekan/ai/conversations/${nextConversationId}/messages`,
  );
  expect(mocks.cancel).not.toHaveBeenCalled();
  expect(screen.queryByText('conversation A question')).not.toBeInTheDocument();
  ui.route(nextConversationId);
  expect(mocks.cancel).not.toHaveBeenCalled();
  expect(mocks.context.navigate).toHaveBeenCalledTimes(1);
});

const nextSiteId = '99999999-9999-4999-8999-999999999999';
const olderConversationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function twoSiteChat() {
  const data = catalog();
  data.websites.push({
    id: nextSiteId,
    name: '第二站',
    domain: 'second.example.com',
    space: { kind: 'personal', id },
  });
  mocks.catalog.mockResolvedValue(data);
  mocks.context.query = { aiSite: siteId, aiConversation: conversationId };
  mocks.connections.mockResolvedValue({ items: [connection()] });
  mocks.messages.mockImplementation(async (value: string) => ({
    items: [
      {
        id: value,
        question:
          value === conversationId
            ? 'site A conversation'
            : value === nextConversationId
              ? 'site B conversation'
              : 'site A older conversation',
        result: answer,
        origin: 'local',
        state: 'completed',
        runId,
      },
    ],
    nextCursor: null,
  }));
  mocks.createConversation.mockResolvedValue({ id: nextConversationId, websiteId: nextSiteId });
  mocks.conversation.mockImplementation(async (value: string) => ({
    id: value,
    websiteId: value === nextConversationId ? nextSiteId : siteId,
  }));
  return routeChat();
}

describe('website and conversation URL scope', () => {
  it('creates a conversation for the selected site while its URL acknowledgment is delayed', async () => {
    const user = userEvent.setup();
    const ui = twoSiteChat();
    expect(await screen.findByText('site A conversation')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('分析网站'), nextSiteId);
    await waitFor(() => expect(screen.getByLabelText('分析网站')).toHaveValue(nextSiteId));
    expect(screen.queryByText('site A conversation')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('分析问题'), 'explicit question for site B');
    await user.click(screen.getByRole('button', { name: '发起分析' }));
    await waitFor(() => expect(mocks.stream).toHaveBeenCalled());
    expect(mocks.createConversation).toHaveBeenCalledWith(nextSiteId);
    expect(mocks.stream.mock.calls[0][0]).toBe(
      `/liekan/ai/conversations/${nextConversationId}/messages`,
    );
    expect(mocks.stream.mock.calls[0][1]).toMatchObject({
      question: 'explicit question for site B',
    });
    ui.route('', nextSiteId);
    expect(await screen.findByText('site B conversation')).toBeInTheDocument();
    ui.route(nextConversationId, nextSiteId);
    await user.type(screen.getByLabelText('分析问题'), 'site B draft');
    ui.route(conversationId, siteId);
    expect(await screen.findByText('site A conversation')).toBeInTheDocument();
    expect(screen.getByLabelText('分析网站')).toHaveValue(siteId);
    expect(screen.getByLabelText('分析问题')).toHaveValue('');
    expect(screen.queryByText('site B conversation')).not.toBeInTheDocument();
  });

  it('follows browser history on the previous site before the selected site URL is acknowledged', async () => {
    const user = userEvent.setup();
    const ui = twoSiteChat();
    expect(await screen.findByText('site A conversation')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('分析网站'), nextSiteId);
    await waitFor(() => expect(screen.getByLabelText('分析网站')).toHaveValue(nextSiteId));
    await user.type(screen.getByLabelText('分析问题'), 'draft for site B');
    ui.route(olderConversationId, siteId);
    expect(await screen.findByText('site A older conversation')).toBeInTheDocument();
    expect(screen.getByLabelText('分析网站')).toHaveValue(siteId);
    expect(screen.getByLabelText('分析问题')).toHaveValue('');
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it('ignores a new-site conversation created after browser history returned to the prior site', async () => {
    const user = userEvent.setup();
    let created: (value: any) => void;
    const ui = twoSiteChat();
    mocks.createConversation.mockImplementation(
      () =>
        new Promise(resolve => {
          created = resolve;
        }),
    );
    expect(await screen.findByText('site A conversation')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('分析网站'), nextSiteId);
    await waitFor(() => expect(screen.getByLabelText('分析网站')).toHaveValue(nextSiteId));
    await user.type(screen.getByLabelText('分析问题'), 'new site B question');
    await user.click(screen.getByRole('button', { name: '发起分析' }));
    await waitFor(() => expect(mocks.createConversation).toHaveBeenCalledWith(nextSiteId));
    ui.route(olderConversationId, siteId);
    expect(await screen.findByText('site A older conversation')).toBeInTheDocument();
    await act(async () => created({ id: nextConversationId, websiteId: nextSiteId }));
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(screen.getByLabelText('分析网站')).toHaveValue(siteId);
  });

  it('preserves cancellation before a site switch and never displays the old late answer on the new site', async () => {
    const user = userEvent.setup();
    let cancel: (value: any) => void, finish: (value: any) => void, signal: AbortSignal;
    twoSiteChat();
    mocks.stream.mockImplementation((_p, _b, s, event) => {
      signal = s;
      event({ type: 'started', runId });
      return new Promise(resolve => {
        finish = resolve;
      });
    });
    mocks.cancel.mockImplementation(
      () =>
        new Promise(resolve => {
          cancel = resolve;
        }),
    );
    await user.type(await screen.findByLabelText('分析问题'), 'active site A question');
    await user.click(screen.getByRole('button', { name: '发起分析' }));
    await user.selectOptions(screen.getByLabelText('分析网站'), nextSiteId);
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith(runId));
    expect(screen.getByLabelText('分析网站')).toHaveValue(siteId);
    expect(signal.aborted).toBe(false);
    await act(async () => cancel(completed({ state: 'cancel_requested' })));
    await waitFor(() => expect(screen.getByLabelText('分析网站')).toHaveValue(nextSiteId));
    expect(signal.aborted).toBe(true);
    await act(async () =>
      finish(completed({ result: { ...answer, summary: 'late site A result' } })),
    );
    expect(screen.queryByText('site A conversation')).not.toBeInTheDocument();
    expect(screen.queryByText('late site A result')).not.toBeInTheDocument();
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
  });
});

it('uses Chinese source and data-state copy with a safe unknown fallback', async () => {
  const user = userEvent.setup();
  mocks.context.query = { aiSite: siteId, aiConversation: conversationId };
  mocks.messages.mockResolvedValue({
    items: [
      {
        id,
        question: '检查状态文案',
        state: 'completed',
        origin: 'local',
        runId,
        result: {
          ...answer,
          metrics: [
            { label: '可用指标', value: 12, state: 'available' },
            { label: '实际指标', value: 3, state: 'actual' },
            { label: '零值指标', value: 0, state: 'zero' },
            { label: '空指标', value: null, state: 'empty' },
            { label: '未知指标', value: null, state: 'future_state' },
          ],
        },
      },
    ],
    nextCursor: null,
  });
  mocks.contextCall.mockResolvedValue({
    expiresAt: '2026-11-03T00:00:00Z',
    facts: {
      website: { name: '研究站' },
      generatedAt: '2026-10-04T00:00:00Z',
      currentRange: { startAt: '2026-09-28T00:00:00Z', endAt: '2026-10-04T00:00:00Z' },
      timeZone: 'Asia/Shanghai',
      rangeNotes: {},
      sourceStates: {
        logs: 'not_connected',
        goals: 'empty',
        human: 'available',
        catalog: 'estimated',
        aiReferrals: 'unsupported',
        future_source: 'future_state',
      },
      facts: [
        { id: 'summary', label: '统计摘要', state: 'available', data: {} },
        { id: 'pages', label: '页面摘要', state: 'future_state', data: {} },
      ],
    },
  });
  mount('ai-chat');
  expect((await screen.findByText('可用指标')).parentElement).toHaveTextContent('实际数据');
  expect(screen.getByText('实际指标').parentElement).toHaveTextContent('实际数据');
  expect(screen.getByText('零值指标').parentElement).toHaveTextContent('实际值为 0');
  expect(screen.getByText('空指标').parentElement).toHaveTextContent('暂无数据');
  expect(screen.getByText('未知指标').parentElement).toHaveTextContent('未知');
  await user.click(screen.getByRole('button', { name: '查看生成时依据' }));
  const modal = screen.getByRole('dialog', { name: '生成时依据' });
  for (const text of [
    'AI日志 · 尚未接入',
    '转化目标 · 暂无数据',
    '访客统计 · 实际数据',
    '网站目录 · 估算数据',
    'AI引荐 · 暂不支持',
    '未知来源 · 未知',
    '统计摘要 · 实际数据',
    '页面摘要 · 未知',
  ])
    expect(await within(modal).findByText(text)).toBeInTheDocument();
  expect(modal).not.toHaveTextContent('not_connected');
  expect(modal).not.toHaveTextContent('future_state');
});

describe('verified conversation resource scope', () => {
  it('hides cached messages and recovered answers for a bookmarked conversation owned by another site', async () => {
    const user = userEvent.setup();
    let confirm: (value: any) => void;
    const ui = twoSiteChat();
    expect(await screen.findByText('site A conversation')).toBeInTheDocument();
    mocks.conversation.mockImplementation(
      () =>
        new Promise(resolve => {
          confirm = resolve;
        }),
    );
    mocks.run.mockResolvedValue(
      completed({ result: { ...answer, summary: 'wrong-site recovered answer' } }),
    );
    sessionStorage.setItem(
      `liekan-ai:${id}:analysis:${nextSiteId}`,
      JSON.stringify({
        clientRequestId: '66666666-6666-4666-8666-666666666666',
        siteId: nextSiteId,
        conversationId,
        runId,
      }),
    );
    ui.client.setQueryData(['liekan-ai', id, 'messages', nextSiteId, conversationId], {
      pages: [
        {
          items: [
            {
              id,
              question: 'cached site A secret history',
              result: answer,
              origin: 'local',
              state: 'completed',
              runId,
            },
          ],
          nextCursor: null,
        },
      ],
      pageParams: [undefined],
    });
    ui.route(conversationId, nextSiteId);
    expect(screen.getByLabelText('分析问题')).toBeDisabled();
    expect(screen.queryByText('cached site A secret history')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.conversation).toHaveBeenCalledWith(conversationId, expect.any(AbortSignal)),
    );
    await act(async () => confirm({ id: conversationId, websiteId: siteId }));
    expect(await screen.findByText(/对话属于其他网站/)).toBeInTheDocument();
    await waitFor(() => expect(mocks.run).toHaveBeenCalledWith(runId, expect.any(AbortSignal)));
    expect(screen.queryByText('wrong-site recovered answer')).not.toBeInTheDocument();
    expect(screen.queryByText('site A conversation')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看生成时依据' })).not.toBeInTheDocument();
    expect(mocks.messages).toHaveBeenCalledTimes(1);
    expect(mocks.conversations).not.toHaveBeenCalledWith(
      nextSiteId,
      undefined,
      expect.any(AbortSignal),
    );
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '切换到「研究站」' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '新建当前网站对话' }));
    await user.type(screen.getByLabelText('分析问题'), 'explicit new question for B');
    await user.click(screen.getByRole('button', { name: '发起分析' }));
    await waitFor(() => expect(mocks.stream).toHaveBeenCalledTimes(1));
    expect(mocks.createConversation).toHaveBeenCalledWith(nextSiteId);
    expect(mocks.stream.mock.calls[0][0]).toBe(
      `/liekan/ai/conversations/${nextConversationId}/messages`,
    );
    expect(mocks.conversation).not.toHaveBeenCalledWith(
      nextConversationId,
      expect.any(AbortSignal),
    );
  });

  it('does not read or submit an unavailable conversation and permits an explicit new conversation', async () => {
    const user = userEvent.setup();
    mocks.context.query = { aiSite: siteId, aiConversation: conversationId };
    mocks.connections.mockResolvedValue({ items: [connection()] });
    mocks.conversation.mockRejectedValue({ status: 404 });
    mount('ai-chat');
    expect(await screen.findByText(/资源或生成时依据不可访问/)).toBeInTheDocument();
    expect(screen.getByLabelText('分析问题')).toBeDisabled();
    expect(mocks.messages).not.toHaveBeenCalled();
    expect(mocks.contextCall).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '新建当前网站对话' }));
    expect(screen.getByLabelText('分析问题')).toBeEnabled();
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it('waits for matching metadata and ignores a late verification for a prior URL conversation', async () => {
    let old: (value: any) => void, current: (value: any) => void;
    mocks.context.query = { aiSite: siteId, aiConversation: conversationId };
    mocks.connections.mockResolvedValue({ items: [connection()] });
    mocks.conversation.mockImplementation(
      value =>
        new Promise(resolve => {
          if (value === conversationId) old = resolve;
          else current = resolve;
        }),
    );
    historyByConversation();
    const ui = routeChat();
    await waitFor(() =>
      expect(mocks.conversation).toHaveBeenCalledWith(conversationId, expect.any(AbortSignal)),
    );
    expect(screen.getByLabelText('分析问题')).toBeDisabled();
    expect(mocks.messages).not.toHaveBeenCalled();
    ui.route(nextConversationId);
    await waitFor(() =>
      expect(mocks.conversation).toHaveBeenCalledWith(nextConversationId, expect.any(AbortSignal)),
    );
    await act(async () => current({ id: nextConversationId, websiteId: siteId }));
    expect(await screen.findByText('conversation B question')).toBeInTheDocument();
    await act(async () => old({ id: conversationId, websiteId: siteId }));
    expect(screen.queryByText('conversation A question')).not.toBeInTheDocument();
    expect(screen.getByLabelText('分析问题')).toBeEnabled();
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it('rejects a metadata response for a different conversation ID even on the selected website', async () => {
    mocks.context.query = { aiSite: siteId, aiConversation: conversationId };
    mocks.conversation.mockResolvedValue({ id: nextConversationId, websiteId: siteId });
    mount('ai-chat');
    expect(await screen.findByText(/对话信息与当前地址不匹配/)).toBeInTheDocument();
    expect(screen.getByLabelText('分析问题')).toBeDisabled();
    expect(mocks.messages).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
  });
});

describe('AI configuration scope changes', () => {
  const teamId = '88888888-8888-4888-8888-888888888888';
  const teamSiteId = '99999999-9999-4999-8999-999999999999';
  it.each([
    ['personal', siteId, teamSiteId],
    ['team', teamSiteId, siteId],
  ])(
    'clears a pending %s credential when URL navigation changes its space',
    async (_kind, from, to) => {
      const user = userEvent.setup();
      const data = catalog();
      data.spaces.push({
        kind: 'team',
        id: teamId,
        name: '团队空间',
        canManage: true,
        canUse: true,
      } as any);
      data.websites.push({
        id: teamSiteId,
        name: '团队站',
        domain: 'team.example',
        space: { kind: 'team', id: teamId },
      } as any);
      mocks.catalog.mockResolvedValue(data);
      mocks.context.query = { aiSite: from };
      const view = mount();
      await user.click(await screen.findByRole('button', { name: '新建 API' }));
      await user.type(screen.getByLabelText('API Key'), 'scope-private-canary');
      mocks.context.query = { aiSite: to };
      view.refreshContext();
      await user.click(await screen.findByRole('button', { name: '新建 API' }));
      expect(screen.getByLabelText('API Key')).toHaveValue('');
      expect(mocks.createConnection).not.toHaveBeenCalled();
      mocks.context.query = { aiSite: from };
      view.refreshContext();
      await user.click(await screen.findByRole('button', { name: '新建 API' }));
      expect(screen.getByLabelText('API Key')).toHaveValue('');
    },
  );
  it('closes an existing connection editor before another space can be displayed', async () => {
    const user = userEvent.setup();
    const data = catalog();
    data.spaces.push({
      kind: 'team',
      id: teamId,
      name: '团队空间',
      canManage: true,
      canUse: true,
    } as any);
    data.websites.push({
      id: teamSiteId,
      name: '团队站',
      domain: 'team.example',
      space: { kind: 'team', id: teamId },
    } as any);
    mocks.catalog.mockResolvedValue(data);
    mocks.connections.mockResolvedValue({ items: [connection()] });
    const view = mount();
    await user.click(await screen.findByRole('button', { name: '编辑' }));
    await user.type(screen.getByLabelText('API Key'), 'editor-private-canary');
    mocks.context.query = { aiSite: teamSiteId };
    view.refreshContext();
    expect(await screen.findByLabelText('AI 所属空间')).toHaveValue('team:' + teamId);
    expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument();
    expect(mocks.updateConnection).not.toHaveBeenCalled();
  });
  it.each([
    ['wrkspc_A', 'wrkspc_B'],
    ['', 'wrkspc_B'],
    ['wrkspc_A', ''],
  ])('requires a replacement credential for workspace %s to %s', async (from, to) => {
    const user = userEvent.setup();
    const existing = {
      ...connection(),
      provider: 'anthropic',
      protocol: 'anthropic-messages',
      workspaceId: from || null,
    };
    mocks.connections.mockResolvedValue({ items: [existing] });
    mocks.updateConnection.mockResolvedValue(existing);
    mount();
    await user.click(await screen.findByRole('button', { name: '编辑' }));
    await user.click(screen.getByText('高级配置'));
    const field = screen.getByLabelText(/工作空间标识/);
    await user.clear(field);
    if (to) await user.type(field, to);
    await user.click(screen.getByRole('button', { name: '保存 API' }));
    expect(await screen.findByText('请填写当前接口的 API Key。')).toBeInTheDocument();
    expect(mocks.updateConnection).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('API Key'), 'replacement-fixture-key');
    await user.click(screen.getByRole('button', { name: '保存 API' }));
    await waitFor(() =>
      expect(mocks.updateConnection).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: to || null, apiKey: 'replacement-fixture-key' }),
      ),
    );
  });
});

it('loads a further bounded catalog page and keeps its website and team available', async () => {
  const user = userEvent.setup();
  const teamId = '88888888-8888-4888-8888-888888888888';
  const teamSiteId = '99999999-9999-4999-8999-999999999999';
  const first = { ...catalog(), nextOffset: 100 };
  const second = {
    ...catalog(),
    nextOffset: null,
    spaces: [{ kind: 'team', id: teamId, name: '分页团队', canManage: true, canUse: true }],
    websites: [
      {
        id: teamSiteId,
        name: '第101个网站',
        domain: 'page.example',
        space: { kind: 'team', id: teamId },
      },
    ],
  };
  mocks.catalog.mockResolvedValueOnce(first).mockResolvedValue(second);
  mount('ai-chat');
  expect(await screen.findByRole('option', { name: '研究站' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '加载更多网站与空间' }));
  expect(await screen.findByRole('option', { name: '第101个网站' })).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('分析网站'), teamSiteId);
  expect(await screen.findByLabelText('分析问题')).toBeEnabled();
  expect(mocks.catalog).toHaveBeenLastCalledWith(expect.any(AbortSignal), { offset: 100 });
  expect(mocks.stream).not.toHaveBeenCalled();
});

it('keeps an active site task when its delayed URL confirmation arrives', async () => {
  const user = userEvent.setup();
  const ui = twoSiteChat();
  expect(await screen.findByText('site A conversation')).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('分析网站'), nextSiteId);
  await waitFor(() => expect(screen.getByLabelText('分析网站')).toHaveValue(nextSiteId));
  let finish!: (run: any) => void;
  const pending = new Promise<any>(resolve => {
    finish = resolve;
  });
  mocks.stream.mockReturnValue(pending);
  await user.type(screen.getByLabelText('分析问题'), 'active site B analysis');
  await user.click(screen.getByRole('button', { name: '发起分析' }));
  await waitFor(() => expect(mocks.stream).toHaveBeenCalled());
  mocks.catalog.mockReturnValue(new Promise(() => {}));
  ui.route('', nextSiteId);
  expect(screen.getByLabelText('分析网站')).toHaveValue(nextSiteId);
  expect(mocks.cancel).not.toHaveBeenCalled();
  await act(async () => finish(completed({ result: answer })));
  expect(mocks.cancel).not.toHaveBeenCalled();
});

it('does not let an old test cancellation close a new space test dialog', async () => {
  const user = userEvent.setup();
  const data = catalog();
  const teamId = '88888888-8888-4888-8888-888888888888';
  const teamSiteId = '99999999-9999-4999-8999-999999999999';
  data.spaces.push({
    kind: 'team',
    id: teamId,
    name: '团队空间',
    canManage: true,
    canUse: true,
  } as any);
  data.websites.push({
    id: teamSiteId,
    name: '团队站',
    domain: 'team.example',
    space: { kind: 'team', id: teamId },
  } as any);
  mocks.catalog.mockResolvedValue(data);
  const first = connection(),
    second = { ...connection(), id: teamSiteId, name: 'Team model' };
  mocks.connections.mockImplementation(async (space: any) => ({
    items: [space.kind === 'team' ? second : first],
  }));
  const view = mount();
  let release!: (run: any) => void;
  mocks.cancel.mockReturnValue(
    new Promise(resolve => {
      release = resolve;
    }),
  );
  mocks.stream.mockImplementation((_path: any, _body: any, _signal: any, onEvent: any) => {
    onEvent({ type: 'started', runId, data: { state: 'accepted' } });
    return new Promise(() => {});
  });
  await user.click(await screen.findByRole('button', { name: '实时测试' }));
  await waitFor(() => expect(mocks.stream).toHaveBeenCalled());
  await user.click(screen.getByRole('button', { name: '关闭' }));
  await waitFor(() => expect(mocks.cancel).toHaveBeenCalled());
  mocks.context.query = { aiSite: teamSiteId };
  view.refreshContext();
  await user.click(await screen.findByRole('button', { name: '实时测试' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('Team model');
  await act(async () => release(completed({ state: 'cancelled' })));
  expect(screen.getByRole('dialog')).toHaveTextContent('Team model');
});

it('retains new recovery metadata after an unmounted test cancellation resolves', async () => {
  const user = userEvent.setup();
  mocks.connections.mockResolvedValue({ items: [connection()] });
  let release!: (run: any) => void;
  mocks.cancel.mockReturnValue(
    new Promise(resolve => {
      release = resolve;
    }),
  );
  mocks.stream.mockImplementation((_path: any, _body: any, _signal: any, onEvent: any) => {
    onEvent({ type: 'started', runId });
    return new Promise(() => {});
  });
  const ui = mount();
  await user.click(await screen.findByRole('button', { name: '实时测试' }));
  await waitFor(() => expect(mocks.stream).toHaveBeenCalled());
  await user.click(screen.getByRole('button', { name: '关闭' }));
  await waitFor(() => expect(mocks.cancel).toHaveBeenCalled());
  ui.unmount();
  const key = `liekan-ai:${id}:test:${connectionId}`;
  const newMetadata = {
    clientRequestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    runId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  };
  sessionStorage.setItem(key, JSON.stringify(newMetadata));
  await act(async () => release(completed({ state: 'cancelled' })));
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(newMetadata);
});

it('keeps a restarted test alive when the previous cancellation returns after completion', async () => {
  const user = userEvent.setup();
  mocks.connections.mockResolvedValue({ items: [connection()] });
  let releaseCancel!: (run: any) => void, finishFirst!: (run: any) => void;
  mocks.cancel.mockReturnValue(
    new Promise(resolve => {
      releaseCancel = resolve;
    }),
  );
  const firstResponse = new Promise(resolve => {
    finishFirst = resolve;
  });
  mocks.stream
    .mockImplementationOnce((_path: any, _body: any, _signal: any, onEvent: any) => {
      onEvent({ type: 'started', runId });
      return firstResponse;
    })
    .mockImplementation((_path: any, _body: any, _signal: any, onEvent: any) => {
      onEvent({ type: 'started', runId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
      return new Promise(() => {});
    });
  mount();
  await user.click(await screen.findByRole('button', { name: '实时测试' }));
  await waitFor(() => expect(mocks.stream).toHaveBeenCalledTimes(1));
  await user.click(screen.getByRole('button', { name: '关闭' }));
  await waitFor(() => expect(mocks.cancel).toHaveBeenCalled());
  await act(async () =>
    finishFirst(completed({ operation: 'test', result: { text: 'LIEKAN_OK' } })),
  );
  await user.click(await screen.findByRole('button', { name: '重新测试，发起新调用' }));
  await waitFor(() => expect(mocks.stream).toHaveBeenCalledTimes(2));
  const newRequest = mocks.stream.mock.calls[1][1];
  const newSignal = mocks.stream.mock.calls[1][2];
  expect(newSignal.aborted).toBe(false);
  await act(async () => releaseCancel(completed({ operation: 'test' })));
  expect(newSignal.aborted).toBe(false);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(JSON.parse(sessionStorage.getItem(`liekan-ai:${id}:test:${connectionId}`)!)).toMatchObject(
    { clientRequestId: newRequest.clientRequestId },
  );
});

it('waits for server acknowledgement and records an early rejection without accepting it', async () => {
  const user = userEvent.setup();
  let reject: (reason: unknown) => void;
  mocks.connections.mockResolvedValue({ items: [connection()] });
  mocks.stream.mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  mount();
  await user.click(await screen.findByRole('button', { name: '实时测试' }));
  const modal = screen.getByRole('dialog', { name: '实时测试' });
  const logs = within(modal).getByRole('list', { name: '测试事件记录' });
  expect(modal.querySelector('[data-ai-run-state="submitting"]')).toHaveTextContent('等待接受请求');
  expect(logs).toHaveTextContent('已发起请求，等待服务端确认');
  expect(logs).not.toHaveTextContent('请求已接受');
  await act(async () => reject({ status: 403 }));
  expect(await within(modal).findByRole('alert')).toHaveTextContent('当前账户没有执行此操作的权限');
  expect(modal.querySelector('[data-ai-run-state="failed"]')).toBeInTheDocument();
  expect(logs).toHaveTextContent('任务未完成');
  expect(logs).not.toHaveTextContent('请求已接受');
});

describe('AI chat home and inline setup', () => {
  it('preserves a question drafted before choosing an explicit website and scopes function links', async () => {
    const user = userEvent.setup();
    mocks.context.href = featureHref;
    mount('ai-chat');
    await user.click(await screen.findByRole('button', { name: '哪些页面值得优先优化？' }));
    await user.click(screen.getByRole('button', { name: '发起分析' }));
    expect(screen.getByText('请先选择要分析的网站，问题会为你保留。')).toBeInTheDocument();
    expect(screen.getByLabelText('分析网站')).toHaveFocus();
    expect(mocks.createConversation).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText('分析网站'), siteId);
    expect(await screen.findByLabelText('分析问题')).toHaveValue('哪些页面值得优先优化？');
    for (const name of ['地域地图', 'AI 抓取分析', '日志访问流']) {
      const href = new URL(
        screen.getByRole('link', { name }).getAttribute('href')!,
        'https://liekan.local',
      );
      expect(href.pathname).toContain(`/websites/${siteId}/geo`);
      expect(href.searchParams.get('date')).toMatch(/^range:\d+:\d+$/);
      expect(href.searchParams.get('live')).toBe('0');
    }
  });

  it('opens centered setup on first send and preserves the question when dismissed', async () => {
    const user = userEvent.setup();
    mocks.context.query = { aiSite: siteId };
    mount('ai-chat');
    await user.type(await screen.findByLabelText('分析问题'), '检查本周的抓取变化');
    await user.click(screen.getByRole('button', { name: '发起分析' }));
    expect(await screen.findByRole('dialog', { name: '配置 AI，开始分析' })).toBeInTheDocument();
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(mocks.createConversation).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '关闭配置 AI，开始分析' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('分析问题')).toHaveValue('检查本周的抓取变化');
    expect(screen.getByRole('button', { name: '发起分析' })).toHaveFocus();
  });

  it('activates a saved connection after a successful test without resending the question', async () => {
    const user = userEvent.setup();
    mocks.context.query = { aiSite: siteId };
    const saved = {
      ...connection(),
      isDefault: false,
      testState: 'untested',
      capabilities: { keyVerified: {} },
    };
    mocks.createConnection.mockResolvedValue(saved);
    mocks.stream.mockImplementation(async (path: string) => {
      if (path.includes('/test')) {
        mocks.connections.mockResolvedValue({ items: [{ ...connection(), isDefault: false }] });
        return completed({ operation: 'test', connectionId, result: { text: '连接成功' } });
      }
      return completed({ result: answer });
    });
    mount('ai-chat');
    await user.type(await screen.findByLabelText('分析问题'), '核查 AI 来源');
    await user.click(screen.getByRole('button', { name: '发起分析' }));
    await user.type(await screen.findByLabelText('API Key'), 'inline-test-key');
    await user.click(screen.getByRole('button', { name: '保存 API' }));
    await user.click(await screen.findByRole('button', { name: '测试连接并启用' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText('分析模型')).toHaveValue(connectionId);
    expect(screen.getByLabelText('分析问题')).toHaveValue('核查 AI 来源');
    expect(mocks.stream).toHaveBeenCalledTimes(1);
    expect(mocks.createConversation).not.toHaveBeenCalled();
    expect(mocks.context.notify).toHaveBeenCalledWith('AI 已配置并生效，可以发送刚才的问题。');
    await user.click(screen.getByRole('button', { name: '发起分析' }));
    await waitFor(() => expect(mocks.stream).toHaveBeenCalledTimes(2));
    expect(mocks.stream.mock.calls[1][1]).toMatchObject({ connectionId, question: '核查 AI 来源' });
  });

  it('ignores a late setup response after explicitly choosing local guidance', async () => {
    const user = userEvent.setup();
    mocks.context.query = { aiSite: siteId };
    mocks.createConnection.mockResolvedValue({
      ...connection(),
      isDefault: false,
      testState: 'untested',
    });
    let release: (value: unknown) => void;
    const pending = new Promise(resolve => {
      release = resolve;
    });
    mocks.stream.mockImplementation(async () => {
      mocks.connections.mockReturnValue(pending);
      return completed({ operation: 'test', connectionId, result: { text: '连接成功' } });
    });
    mount('ai-chat');
    await user.click(await screen.findByRole('button', { name: '去配置' }));
    await user.type(screen.getByLabelText('API Key'), 'race-test-key');
    await user.click(screen.getByRole('button', { name: '保存 API' }));
    await user.click(await screen.findByRole('button', { name: '测试连接并启用' }));
    const dialog = await screen.findByRole('dialog', { name: '实时测试' });
    await user.click(within(dialog).getByRole('button', { name: /^关闭$/ }));
    await user.click(await screen.findByRole('button', { name: '先查看本地接入指引' }));
    await act(async () => {
      release({ items: [{ ...connection(), isDefault: false }] });
    });
    expect(screen.getByLabelText('分析模型')).toHaveValue('local');
    expect(mocks.context.notify).not.toHaveBeenCalledWith('AI 已配置并生效，可以发送刚才的问题。');
  });

  it('keeps a new test open when an earlier successful activation response arrives late', async () => {
    const user = userEvent.setup();
    mocks.context.query = { aiSite: siteId };
    mocks.createConnection.mockResolvedValue({
      ...connection(),
      isDefault: false,
      testState: 'untested',
    });
    let releaseConnections: (value: unknown) => void;
    let finishRetry: (value: unknown) => void;
    const pendingConnections = new Promise(resolve => {
      releaseConnections = resolve;
    });
    const retry = new Promise(resolve => {
      finishRetry = resolve;
    });
    mocks.stream
      .mockImplementationOnce(async () => {
        mocks.connections.mockReturnValue(pendingConnections);
        return completed({ operation: 'test', connectionId, result: { text: '连接成功' } });
      })
      .mockReturnValueOnce(retry);
    mount('ai-chat');
    await user.click(await screen.findByRole('button', { name: '去配置' }));
    await user.type(screen.getByLabelText('API Key'), 'retry-test-key');
    await user.click(screen.getByRole('button', { name: '保存 API' }));
    await user.click(await screen.findByRole('button', { name: '测试连接并启用' }));
    await user.click(await screen.findByRole('button', { name: '重新测试，发起新调用' }));
    await act(async () => {
      releaseConnections({ items: [{ ...connection(), isDefault: false }] });
    });
    expect(screen.getByRole('dialog', { name: '实时测试' })).toBeInTheDocument();
    expect(mocks.context.notify).not.toHaveBeenCalledWith('AI 已配置并生效，可以发送刚才的问题。');
    await act(async () => {
      finishRetry(completed({ operation: 'test', connectionId, state: 'cancelled' }));
    });
  });

  it('keeps failed setup available without enabling an unverified connection', async () => {
    const user = userEvent.setup();
    mocks.context.query = { aiSite: siteId };
    mocks.createConnection.mockResolvedValue({ ...connection(), testState: 'untested' });
    mocks.stream.mockImplementation(async () => {
      mocks.connections.mockResolvedValue({ items: [connection()] });
      return completed({
        operation: 'test',
        connectionId,
        state: 'failed',
        error: { code: 'upstream' },
      });
    });
    mount('ai-chat');
    await user.click(await screen.findByRole('button', { name: '去配置' }));
    await user.type(screen.getByLabelText('API Key'), 'invalid-test-key');
    await user.click(screen.getByRole('button', { name: '保存 API' }));
    await user.click(await screen.findByRole('button', { name: '测试连接并启用' }));
    expect(await screen.findByRole('dialog', { name: '实时测试' })).toBeInTheDocument();
    await waitFor(() => expect(mocks.stream).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('分析模型')).toHaveValue('');
    expect(mocks.context.notify).not.toHaveBeenCalledWith('AI 已配置并生效，可以发送刚才的问题。');
    expect(mocks.createConversation).not.toHaveBeenCalled();
  });
});
