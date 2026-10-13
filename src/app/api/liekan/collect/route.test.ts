import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ send: vi.fn(), authorize: vi.fn() }));
vi.mock('@/app/api/send/route', () => ({ POST: mocks.send }));
vi.mock('@/lib/liekan/upstream/server', async () => {
  const { LiekanError } = await import('@/lib/liekan/upstream/errors');
  return { LiekanError, authorize: mocks.authorize };
});
import { POST } from './route';
import { isAuthenticatedCollection } from '@/lib/liekan/upstream/collection-auth';
beforeEach(() => vi.resetAllMocks());

it('rejects an oversized unauthenticated body promptly before authorization', async () => {
  const request = new Request('http://localhost/api/liekan/collect', {
    method: 'POST',
    body: 'x'.repeat(1024 * 1024 + 1),
  });
  const response = await Promise.race([
    POST(request),
    new Promise<null>(resolve => setTimeout(() => resolve(null), 500)),
  ]);
  expect(response?.status).toBe(413);
  expect(mocks.authorize).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});

it('forwards the single bounded body only after live management authorization', async () => {
  const website = 'd6082e38-9897-4312-89b2-e80dfb758f1d';
  const body = { type: 'event', payload: { website, url: '/home', hostname: 'example.com' } };
  mocks.authorize.mockResolvedValue({ website: { id: website } });
  let forwarded: Request;
  mocks.send.mockImplementation(async (request: Request) => {
    forwarded = request;
    expect(isAuthenticatedCollection(request)).toBe(true);
    expect(await request.json()).toEqual(body);
    expect(request.headers.get('authorization')).toBe('Bearer fixture-token');
    expect(request.headers.has('content-length')).toBe(false);
    return Response.json({ cache: 'fixture-cache' });
  });
  const request = new Request('http://localhost/api/liekan/collect', {
    method: 'POST',
    headers: { authorization: 'Bearer fixture-token', 'content-length': '1' },
    body: JSON.stringify(body),
  });
  expect((await POST(request)).status).toBe(200);
  expect(mocks.authorize).toHaveBeenCalledWith(request, website, true);
  expect(isAuthenticatedCollection(forwarded!)).toBe(false);
});
