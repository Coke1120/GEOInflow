// @vitest-environment node
import { expect, test, vi } from 'vitest';
import { z } from 'zod';
import { callAiModel } from './model';

const key = 'isolated-canary-credential-X7';
const connection = {
  provider: 'custom',
  protocol: 'openai-chat',
  base_url: 'https://models.example/v1',
  model: 'fixture',
  capabilities: {
    documented: { usage: false },
    keyVerified: { stream: true, structuredOutput: false },
  },
} as any;
function input(boundary: typeof fetch, stream: boolean, apiKey = key) {
  return {
    connection,
    apiKey,
    system: 'Fixture.',
    prompt: 'Fixture.',
    maxOutputTokens: 2048,
    signal: new AbortController().signal,
    stream,
    onText: vi.fn(),
    fetch: boundary,
  };
}
function plain(text: string) {
  return (async () =>
    Response.json({
      id: 'fixture',
      model: 'fixture',
      created: 1,
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    })) as typeof fetch;
}
function stream(parts: string[]) {
  return (async () =>
    new Response(
      parts
        .map(
          content =>
            `data: ${JSON.stringify({ id: 'fixture', created: 1, model: 'fixture', choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`,
        )
        .join('') +
        `data: ${JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
      { headers: { 'content-type': 'text/event-stream' } },
    )) as typeof fetch;
}
test('rejects a successful plain response echoing the current credential', async () => {
  await expect(callAiModel(input(plain('LIEKAN_OK ' + key), false))).rejects.toMatchObject({
    code: 'protocol',
  });
});
test.each([
  { parts: ['LIEKAN_OK ' + key] },
  { parts: ['LIEKAN_OK ' + key.slice(0, 12), key.slice(12)] },
])('blocks credential before any preview across $parts.length deltas', async ({ parts }) => {
  const request = input(stream(parts), true);
  await expect(callAiModel(request)).rejects.toMatchObject({ code: 'protocol' });
  expect(request.onText.mock.calls.map(([text]) => text).join('')).not.toContain(key);
  expect(request.onText).not.toHaveBeenCalled();
});
test.each([{ structured: false }, { structured: true }])(
  'rejects unicode escaped credential in a JSON answer, structured=$structured',
  async ({ structured }) => {
    const escaped = key
      .split('')
      .map(char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'))
      .join('');
    const request = input(plain('{"summary":"' + escaped + '"}'), false);
    await expect(
      callAiModel({
        ...request,
        ...(structured ? { schema: z.object({ summary: z.string() }) } : {}),
      }),
    ).rejects.toMatchObject({ code: 'protocol' });
  },
);
test('blocks JSON escaped quote and slash credentials in split streaming JSON', async () => {
  const apiKey = 'isolated-"\\credential-X7',
    encoded = JSON.stringify(apiKey).slice(1, -1),
    parts = ['{"summary":"' + encoded.slice(0, 17), encoded.slice(17) + '"}'],
    request = input(stream(parts), true, apiKey);
  await expect(callAiModel(request)).rejects.toMatchObject({ code: 'protocol' });
  expect(request.onText).not.toHaveBeenCalled();
});
test('retains a safe response and flushes its remaining preview only on a valid stop', async () => {
  const request = input(stream(['LIEKAN_OK', ' safe']), true);
  const result = await callAiModel(request);
  expect(result.text).toBe('LIEKAN_OK safe');
  expect(request.onText.mock.calls.map(([text]) => text).join('')).toBe(result.text);
});

test('retains only bounded safe provider response metadata', async () => {
  const request = input(
    (async () =>
      Response.json(
        {
          id: 'fixture',
          model: 'fixture',
          created: 1,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'LIEKAN_OK safe' },
              finish_reason: 'stop',
            },
          ],
        },
        { headers: { 'x-request-id': 'req-isolated-123', 'x-secret': key } },
      )) as typeof fetch,
    false,
  );
  expect((await callAiModel(request)).providerResponse).toEqual({
    status: 200,
    requestId: 'req-isolated-123',
  });
});
test('drops a provider request identifier echoing the known key', async () => {
  const request = input(
    (async () =>
      Response.json(
        {
          id: 'fixture',
          model: 'fixture',
          created: 1,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'LIEKAN_OK safe' },
              finish_reason: 'stop',
            },
          ],
        },
        { headers: { 'x-request-id': key } },
      )) as typeof fetch,
    false,
  );
  expect((await callAiModel(request)).providerResponse).toEqual({ status: 200, requestId: null });
});

test('aborts the underlying unfinished request when rejecting a credential echo', async () => {
  let sentSignal: AbortSignal | undefined;
  const request = input(
    (async (_url, init) => {
      sentSignal = init?.signal as AbortSignal;
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                'data: ' +
                  JSON.stringify({
                    id: 'fixture',
                    model: 'fixture',
                    choices: [{ index: 0, delta: { content: key }, finish_reason: null }],
                  }) +
                  '\n\n',
              ),
            );
            sentSignal?.addEventListener('abort', () => controller.close(), { once: true });
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    }) as typeof fetch,
    true,
  );
  await expect(callAiModel(request)).rejects.toMatchObject({ code: 'protocol' });
  expect(sentSignal?.aborted).toBe(true);
});

test('guards credentials normalized by HTTP headers in existing stored connections', async () => {
  const request = input(plain('LIEKAN_OK ' + key), false, key + ' ');
  await expect(callAiModel(request)).rejects.toMatchObject({ code: 'protocol' });
});
test('drops normalized credentials echoed in a provider request identifier', async () => {
  const request = input(
    (async () =>
      Response.json(
        {
          id: 'fixture',
          model: 'fixture',
          created: 1,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'LIEKAN_OK safe' },
              finish_reason: 'stop',
            },
          ],
        },
        { headers: { 'x-request-id': key } },
      )) as typeof fetch,
    false,
    key + ' ',
  );
  expect((await callAiModel(request)).providerResponse?.requestId).toBeNull();
});

test.each([
  { finish: 'length', text: 'truncated', code: 'truncated_output' },
  { finish: 'content_filter', text: '', code: 'refused_output' },
  { finish: 'stop', text: '', code: 'empty_output' },
])(
  'classifies successful HTTP responses with $finish and incomplete text',
  async ({ finish, text, code }) => {
    const request = input(
      (async () =>
        Response.json(
          {
            id: 'fixture',
            model: 'fixture',
            created: 1,
            choices: [
              { index: 0, message: { role: 'assistant', content: text }, finish_reason: finish },
            ],
          },
          { headers: { 'x-request-id': 'req-isolated-incomplete' } },
        )) as typeof fetch,
      false,
    );
    await expect(callAiModel(request)).rejects.toMatchObject({
      code,
      providerResponse: { status: 200, requestId: 'req-isolated-incomplete' },
    });
  },
);
