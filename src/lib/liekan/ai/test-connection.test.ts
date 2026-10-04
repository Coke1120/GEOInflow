// @vitest-environment node
import { expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ call: vi.fn(), stage: vi.fn(), complete: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { client: {} }, getRawQueryClient: vi.fn() }));
vi.mock('./model', () => ({ callAiModel: mocks.call }));
vi.mock('./crypto', () => ({ decryptAiKey: () => 'isolated-key' }));
vi.mock('./runs', () => ({
  acceptAiRun: vi.fn(),
  setAiRunStage: mocks.stage,
  completeAiRun: mocks.complete,
}));
import { executeAiTest } from './test-connection';
test('keeps only safe response metadata and the incomplete-test message when the marker is missing', async () => {
  mocks.call.mockResolvedValue({
    text: 'valid text without the marker',
    providerResponse: { status: 200, requestId: 'req-isolated' },
  });
  const execution = {
    actor: { id: 'fixture' },
    handle: {
      connection: {
        id: 'fixture',
        provider: 'custom',
        model: 'fixture',
        owner_user_id: 'fixture',
        capabilities: { documented: { stream: false } },
      },
    },
    signal: new AbortController().signal,
    emit: vi.fn(),
  } as any;
  await expect(executeAiTest(execution)).rejects.toMatchObject({
    code: 'test_incomplete',
    message: '收到响应，文本测试未完成。请检查模型输出后重新测试。',
    providerResponse: { status: 200, requestId: 'req-isolated' },
  });
  expect(mocks.complete).not.toHaveBeenCalled();
});
