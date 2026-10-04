// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { callAiModel } from './model';

const connection = {
  provider: 'minimax',
  protocol: 'openai-chat',
  base_url: 'https://api.minimax.io/v1',
  model: 'MiniMax-M3',
  capabilities: { keyVerified: { stream: null, structuredOutput: null } },
};
it('maps the approved MiniMax output budget and makes one paid request', async () => {
  const boundary = vi.fn(async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    expect(body.max_completion_tokens).toBe(512);
    expect(body.max_tokens).toBeUndefined();
    expect(body.thinking).toEqual({ type: 'disabled' });
    return Response.json({
      id: 'fixture',
      model: 'MiniMax-M3',
      created: 1,
      choices: [
        { index: 0, message: { role: 'assistant', content: 'LIEKAN_OK' }, finish_reason: 'stop' },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
    });
  });
  const result = await callAiModel({
    connection: connection as any,
    apiKey: 'isolatedfixture',
    system: 'Respond safely.',
    prompt: 'LIEKAN_OK',
    maxOutputTokens: 512,
    signal: new AbortController().signal,
    stream: false,
    onText: () => {},
    fetch: boundary as typeof fetch,
  });
  expect(result.text).toBe('LIEKAN_OK');
  expect(result.ttftMs).toBeNull();
  expect(result.usage?.totalTokens).toBe(15);
  expect(boundary).toHaveBeenCalledTimes(1);
});
it.each([
  ['openai', 'https://api.openai.com/v1', 'gpt-5.4-mini'],
  ['gemini', 'https://generativelanguage.googleapis.com/v1beta/openai', 'gemini-3.8-flash'],
  ['deepseek', 'https://api.deepseek.com', 'deepseek-flash'],
  ['qwen', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen-plus'],
  ['kimi', 'https://api.moonshot.cn/v1', 'kimi-k3'],
  ['custom', 'https://models.example.com/v1', 'test-fixture-model'],
])(
  'uses the real %s SDK with one text request and the analysis output limit',
  async (provider, base_url, model) => {
    const boundary = vi.fn(async (url: any, init: any) => {
      expect(String(url)).toBe(`${base_url}/chat/completions`);
      const body = JSON.parse(init.body);
      expect(body.model).toBe(model);
      expect(body.max_tokens ?? body.max_completion_tokens).toBe(2048);
      expect(body.tools).toBeUndefined();
      if (provider === 'kimi') expect(body.reasoning_effort).toBe('low');
      return Response.json({
        id: 'fixture',
        model,
        created: 1,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'safe fixture text' },
            finish_reason: 'stop',
          },
        ],
      });
    });
    const result = await callAiModel({
      connection: { ...connection, provider, base_url, model } as any,
      apiKey: 'fixture-key',
      system: 'Fixture rules.',
      prompt: 'Fixture text.',
      maxOutputTokens: 2048,
      signal: new AbortController().signal,
      stream: false,
      onText: () => {},
      fetch: boundary as typeof fetch,
    });
    expect(result.text).toBe('safe fixture text');
    expect(result.usage).toBeNull();
    expect(boundary).toHaveBeenCalledTimes(1);
  },
);
it('uses Anthropic Messages with the fixed version and optional workspace header', async () => {
  const boundary = vi.fn(async (url: any, init: any) => {
    expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
    expect(new Headers(init.headers).get('anthropic-version')).toBe('2023-06-01');
    expect(new Headers(init.headers).get('anthropic-workspace-id')).toBe('wrkspc_fixture');
    const body = JSON.parse(init.body);
    expect(body.max_tokens).toBe(512);
    return Response.json({
      id: 'msg_fixture',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5-5',
      content: [{ type: 'text', text: 'LIEKAN_OK' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 2 },
    });
  });
  const result = await callAiModel({
    connection: {
      ...connection,
      provider: 'anthropic',
      protocol: 'anthropic-messages',
      base_url: 'https://api.anthropic.com/v1',
      model: 'claude-sonnet-5-5',
      workspace_id: 'wrkspc_fixture',
    } as any,
    apiKey: 'fixture-key',
    system: 'Fixture rules.',
    prompt: 'Fixture.',
    maxOutputTokens: 512,
    signal: new AbortController().signal,
    stream: false,
    onText: () => {},
    fetch: boundary as typeof fetch,
  });
  expect(result.text).toBe('LIEKAN_OK');
  expect(boundary).toHaveBeenCalledTimes(1);
});
it('streams visible text, omits reasoning previews and rejects truncated output without retry', async () => {
  const fragments: string[] = [];
  const boundary = vi.fn(
    async () =>
      new Response(
        [
          'data: ' +
            JSON.stringify({
              id: 'fixture',
              choices: [
                {
                  index: 0,
                  delta: { reasoning_content: 'private reasoning' },
                  finish_reason: null,
                },
              ],
            }),
          'data: ' +
            JSON.stringify({
              id: 'fixture',
              choices: [{ index: 0, delta: { content: 'visible' }, finish_reason: null }],
            }),
          'data: ' +
            JSON.stringify({
              id: 'fixture',
              choices: [{ index: 0, delta: {}, finish_reason: 'length' }],
            }),
          'data: [DONE]',
        ].join('\n\n') + '\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      ),
  );
  await expect(
    callAiModel({
      connection: connection as any,
      apiKey: 'fixture-key',
      system: 'Fixture.',
      prompt: 'Fixture.',
      maxOutputTokens: 512,
      signal: new AbortController().signal,
      stream: true,
      onText: text => fragments.push(text),
      fetch: boundary as typeof fetch,
    }),
  ).rejects.toMatchObject({ code: 'truncated_output' });
  expect(fragments).toEqual([]);
  expect(boundary).toHaveBeenCalledTimes(1);
});
