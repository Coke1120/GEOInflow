// @vitest-environment node
import 'dotenv/config';
import { beforeEach, expect, it, vi } from 'vitest';
const { after, auth } = vi.hoisted(() => ({ after: vi.fn(), auth: vi.fn() }));
vi.mock('next/server', () => ({ after }));
vi.mock('../upstream/ai-access', () => ({ authenticateAiRequest: auth }));
import { aiApi, readAiBody } from './http';
import { AiError } from './error';
beforeEach(() => {
  after.mockClear();
  auth.mockReset();
});
it('denies anonymous AI access without scheduling database maintenance', async () => {
  auth.mockRejectedValue(new AiError('session_required', '请完成登录', 401));
  const result = await aiApi(new Request('https://example.com/api/liekan/ai/catalog'), async () => {
    throw Error('should not enter');
  });
  expect(result.status).toBe(401);
  expect(result.headers.get('cache-control')).toBe('private, no-store');
  expect(after).not.toHaveBeenCalled();
});
it('returns only a static public error for unexpected backend failures', async () => {
  auth.mockResolvedValue({ id: 'fixture', role: 'user' });
  const result = await aiApi(new Request('https://example.com/api/liekan/ai/catalog'), async () => {
    throw Error('sk-fixture-secret and private question');
  });
  expect(result.status).toBe(503);
  expect(await result.text()).not.toContain('sk-fixture-secret');
  expect(after).toHaveBeenCalledTimes(1);
});
it('rejects oversized request JSON through the bounded read boundary', async () => {
  await expect(
    readAiBody(
      new Request('https://example.com', {
        method: 'POST',
        body: JSON.stringify({ question: 'a'.repeat(33000) }),
      }),
    ),
  ).rejects.toMatchObject({ status: 413 });
});
