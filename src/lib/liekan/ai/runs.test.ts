import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ execute: vi.fn(), query: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { client: {} }, getRawQueryClient: vi.fn() }));
vi.mock('../upstream/ai-db', () => ({ aiTransaction: (fn: any) => fn(mocks) }));
import { failAiRun, type AiRunHandle } from './runs';
beforeEach(() => {
  mocks.execute.mockReset().mockResolvedValue(1);
  mocks.query.mockReset();
});
test.each(['facts_timeout', 'facts_unavailable'])(
  'persists static facts error %s for recovery',
  async code => {
    await failAiRun(
      {
        row: { id: 'run', operation: 'analysis' },
        token: 'lease',
        connection: null,
      } as unknown as AiRunHandle,
      code,
    );
    expect(mocks.execute.mock.calls[0][4]).toBe(code);
    expect(mocks.execute.mock.calls[0][5]).toMatch(
      code === 'facts_timeout' ? /缩小日期范围/ : /统计数据/,
    );
  },
);
test('unknown failures persist only the static upstream error', async () => {
  await failAiRun(
    {
      row: { id: 'run', operation: 'analysis' },
      token: 'lease',
      connection: null,
    } as unknown as AiRunHandle,
    'secret-provider-error',
  );
  expect(mocks.execute.mock.calls[0][4]).toBe('upstream');
  expect(mocks.execute.mock.calls[0][5]).not.toContain('secret');
});

test('keeps input budgeting failures distinct from provider transport size failures', async () => {
  const handle = {
    row: { id: 'run', operation: 'analysis' },
    token: 'lease',
    connection: null,
  } as unknown as AiRunHandle;
  await failAiRun(handle, 'input_budget');
  expect(mocks.execute.mock.calls[0][4]).toBe('input_budget');
  expect(mocks.execute.mock.calls[0][5]).toContain('模型输入预算');
  mocks.execute.mockClear();
  await failAiRun(handle, 'oversize');
  expect(mocks.execute.mock.calls[0][4]).toBe('oversize');
  expect(mocks.execute.mock.calls[0][5]).toContain('允许大小');
});

test('persists only validated response metadata in the existing result column', async () => {
  const handle = {
    row: { id: 'run', operation: 'analysis' },
    token: 'lease',
    connection: null,
  } as unknown as AiRunHandle;
  await failAiRun(handle, 'network', 'failed', { status: 503, requestId: 'req-isolated' });
  expect(mocks.execute.mock.calls[0][0]).toContain('SET test_result=');
  expect(JSON.parse(mocks.execute.mock.calls[0][6])).toEqual({
    providerResponse: { status: 503, requestId: 'req-isolated' },
  });
  mocks.execute.mockClear();
  await failAiRun(handle, 'network', 'failed', {
    status: 503,
    requestId: 'req-isolated',
    body: 'secret provider body',
  });
  expect(mocks.execute.mock.calls[0][6]).toBeNull();
});
