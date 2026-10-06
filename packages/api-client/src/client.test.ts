import { describe, expect, expectTypeOf, test } from 'vitest';
import { UmamiClient } from './client';
import { type OperationOutput, operations } from './generated/operations';

interface Captured {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function createClient(response: unknown = {}, options: Record<string, unknown> = {}) {
  const calls: Captured[] = [];
  const client = new UmamiClient({
    baseUrl: 'https://example.com/api',
    token: 'token',
    ...options,
    fetch: async (url, init) => {
      calls.push({
        url: new URL(url.toString()),
        method: init?.method ?? 'GET',
        headers: init?.headers as Record<string, string>,
        body: init?.body as string | undefined,
      });

      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  return { client, calls };
}

describe('UmamiClient', () => {
  test('exposes a method for every generated operation', () => {
    const client = new UmamiClient({ fetch: async () => new Response('{}') });

    for (const operationId of Object.keys(operations)) {
      expect(typeof (client as unknown as Record<string, unknown>)[operationId]).toBe('function');
    }
  });

  test('builds GET requests with path and query parameters', async () => {
    const { client, calls } = createClient({ pageviews: 1 });

    await client.getWebsiteStats({ websiteId: 'w1', startAt: 1, endAt: 2, browser: 'chrome' });

    expect(calls[0].method).toBe('GET');
    expect(calls[0].url.pathname).toBe('/api/websites/w1/stats');
    expect(calls[0].url.searchParams.get('startAt')).toBe('1');
    expect(calls[0].url.searchParams.get('browser')).toBe('chrome');
    expect(calls[0].headers.authorization).toBe('Bearer token');
  });

  test('supports the legacy positional signature', async () => {
    const { client, calls } = createClient([]);

    await client.getWebsiteMetrics('w1', { startAt: 1, endAt: 2, type: 'url' });
    await client.getWebsiteSession('w1', 's1');

    expect(calls[0].url.pathname).toBe('/api/websites/w1/metrics');
    expect(calls[0].url.searchParams.get('type')).toBe('url');
    expect(calls[1].url.pathname).toBe('/api/websites/w1/sessions/s1');
  });

  test('sends JSON bodies for POST operations', async () => {
    const { client, calls } = createClient([]);

    await client.createWebsiteFunnel({
      websiteId: 'w1',
      name: 'Signup funnel',
      parameters: { window: 60, steps: [] },
    });

    expect(calls[0].method).toBe('POST');
    expect(calls[0].url.pathname).toBe('/api/websites/w1/funnels');
    expect(JSON.parse(calls[0].body as string)).toEqual({
      name: 'Signup funnel',
      parameters: { window: 60, steps: [] },
    });
  });

  test('sends structured funnel criteria through the GET stats API', async () => {
    const { client, calls } = createClient([]);
    const steps = [
      { type: 'path', value: '/a?x=1&y=日本語' },
      { type: 'event', value: 'signup' },
    ];
    await client.getWebsiteFunnelStats({
      websiteId: 'w1',
      startAt: 1,
      endAt: 2,
      window: 60,
      steps: JSON.stringify(steps),
      browser1: 'eq.Chrome',
    });
    expect(calls[0].method).toBe('GET');
    expect(calls[0].body).toBeUndefined();
    expect(calls[0].url.pathname).toBe('/api/websites/w1/funnels/stats');
    expect(JSON.parse(calls[0].url.searchParams.get('steps') ?? 'null')).toEqual(steps);
    expect(calls[0].url.searchParams.get('browser1')).toBe('eq.Chrome');
  });

  test('uses the Cloud base URL and API key header by default', async () => {
    const calls: Captured[] = [];
    const client = new UmamiClient({
      apiKey: 'api-key',
      fetch: async (url, init) => {
        calls.push({
          url: new URL(url.toString()),
          method: init?.method ?? 'GET',
          headers: init?.headers as Record<string, string>,
        });
        return new Response('{"data":[]}', { headers: { 'content-type': 'application/json' } });
      },
    });

    await client.listWebsites();

    expect(calls[0].url.toString()).toBe('https://api.umami.is/v1/websites');
    expect(calls[0].headers['x-umami-api-key']).toBe('api-key');
  });

  test('merges custom and per-request headers', async () => {
    const { client, calls } = createClient({}, { headers: { 'x-a': '1' } });

    await client.getMe(undefined, { headers: { 'x-b': '2' } });

    expect(calls[0].headers).toMatchObject({ 'x-a': '1', 'x-b': '2' });
  });

  test('withToken returns a client using the new token', async () => {
    const { client, calls } = createClient({});

    await client.withToken('other').getMe();

    expect(calls[0].headers.authorization).toBe('Bearer other');
  });

  test('call() invokes any operation by id', async () => {
    const { client, calls } = createClient({ visitors: 3 });

    const result = await client.call('getWebsiteActive', { websiteId: 'w1' });

    expect(result).toEqual({ visitors: 3 });
    expect(calls[0].url.pathname).toBe('/api/websites/w1/active');
  });
});

test('declares both JSON and SSE AI responses without retrying the paid POST', async () => {
  type Run = OperationOutput<'getLiekanAiRun'>;
  expectTypeOf<OperationOutput<'testLiekanAiConnection'>>().toEqualTypeOf<Run | string>();
  expectTypeOf<OperationOutput<'postLiekanAiAnalysis'>>().toEqualTypeOf<Run | string>();
  const stream = 'event: done\ndata: {"state":"completed"}\n\n';
  const calls: string[] = [];
  const client = new UmamiClient({
    fetch: async url => {
      calls.push(url.toString());
      return calls.length === 1
        ? new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
        : new Response('{"state":"completed"}', {
            headers: { 'content-type': 'application/json' },
          });
    },
  });
  const input = { id: 'fixture', clientRequestId: 'fixture-request', expectedConfigVersion: 1 };
  expect(await client.testLiekanAiConnection(input)).toBe(stream);
  expect(await client.testLiekanAiConnection(input)).toEqual({ state: 'completed' });
  expect(calls).toHaveLength(2);
});
