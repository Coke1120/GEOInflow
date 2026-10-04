import { expect, it, vi } from 'vitest';

vi.mock('@/lib/client', () => ({ getClientAuthToken: () => 'isolated-fixture-token' }));

import { aiClient, streamAiRun } from './ai-client';

const id = '11111111-1111-4111-8111-111111111111';
const frame = (sequence: number, type: string, data: unknown) =>
  `event: ${type}\ndata: ${JSON.stringify({ protocolVersion: 1, runId: id, sequence, type, data })}\n\n`;
it('consumes split UTF-8 SSE frames using bearer POST without restarting a request', async () => {
  const bytes = new TextEncoder().encode(
    ': heartbeat\n\n' +
      frame(1, 'started', { runId: id }) +
      frame(2, 'delta', { text: '中文预览' }) +
      frame(3, 'done', { id, state: 'completed' }),
  );
  const events: any[] = [];
  const boundary = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer isolated-fixture-token');
    return new Response(
      new ReadableStream({
        start(c) {
          for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7));
          c.close();
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
  });
  try {
    const result = await streamAiRun(
      '/liekan/ai/connections/' + id + '/test',
      { clientRequestId: id, expectedConfigVersion: 1 },
      new AbortController().signal,
      event => events.push(event),
    );
    expect(result.state).toBe('completed');
    expect(events[1].data.text).toBe('中文预览');
    expect(boundary).toHaveBeenCalledTimes(1);
  } finally {
    boundary.mockRestore();
  }
});
it('returns the prior accepted JSON task without replaying its provider request', async () => {
  const boundary = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(Response.json({ id, state: 'accepted' }, { status: 202 }));
  try {
    expect(
      (await streamAiRun('/liekan/ai/runs/' + id, {}, new AbortController().signal, () => {}))
        .state,
    ).toBe('accepted');
    expect(boundary).toHaveBeenCalledTimes(1);
  } finally {
    boundary.mockRestore();
  }
});
it('keeps the known run ID for recovery when the event stream stops before completion', async () => {
  const boundary = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(frame(1, 'started', { runId: id }), {
      headers: { 'content-type': 'text/event-stream' },
    }),
  );
  try {
    await expect(
      streamAiRun('/liekan/ai/runs/' + id, {}, new AbortController().signal, () => {}),
    ).rejects.toMatchObject({ code: 'stream_incomplete', runId: id });
    expect(boundary).toHaveBeenCalledTimes(1);
  } finally {
    boundary.mockRestore();
  }
});

it.each([
  frame(1, 'delta', { text: 'unstarted' }) + frame(2, 'done', { id, state: 'completed' }),
  frame(1, 'started', { runId: id }) +
    frame(2, 'done', { id: '22222222-2222-4222-8222-222222222222', state: 'completed' }),
  frame(1, 'started', { runId: id }) + frame(2, 'done', { id, state: 'accepted' }),
  frame(1, 'started', { runId: id }) +
    frame(2, 'done', { id, state: 'completed' }) +
    frame(3, 'delta', { text: 'late' }),
])('rejects incomplete or mismatched task event contracts', async body => {
  const boundary = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
  try {
    await expect(
      streamAiRun('/liekan/ai/runs/' + id, {}, new AbortController().signal, () => {}),
    ).rejects.toMatchObject({ code: 'protocol' });
    expect(boundary).toHaveBeenCalledTimes(1);
  } finally {
    boundary.mockRestore();
  }
});

it('reads typed conversation metadata using a single authenticated GET and forwards cancellation', async () => {
  const websiteId = '22222222-2222-4222-8222-222222222222';
  const controller = new AbortController();
  const boundary = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    expect(new URL(String(url)).pathname).toBe(`/api/liekan/ai/conversations/${id}`);
    expect(init?.method).toBe('GET');
    expect(init?.body).toBeUndefined();
    expect(init?.signal).toBe(controller.signal);
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer isolated-fixture-token');
    expect(new Headers(init?.headers).get('cache-control')).toBe('no-store');
    return Response.json({
      id,
      websiteId,
      title: '归属校验',
      createdAt: '2026-10-04T00:00:00Z',
      updatedAt: '2026-10-04T00:00:00Z',
      expiresAt: '2026-11-03T00:00:00Z',
    });
  });
  try {
    const result = await aiClient.conversation(id, controller.signal);
    expect(result).toMatchObject({ id, websiteId });
    expect(boundary).toHaveBeenCalledTimes(1);
  } finally {
    boundary.mockRestore();
  }
});
