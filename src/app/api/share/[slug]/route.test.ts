import bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ share: null as any, entity: { userId: 'owner' } }));
vi.mock('@/queries/prisma', () => ({ getShareByCode: async () => state.share }));
vi.mock('@/lib/redis', () => ({ default: { enabled: false } }));
vi.mock('@/lib/prisma', () => ({ default: { client: {} }, getRawQueryClient: () => ({}) }));
vi.mock('@/lib/liekan/upstream/live-share', () => ({
  currentShareScope: async () => ({
    shareId: state.share.id,
    shareType: 1,
    websiteId: 'site',
    parameters: { overview: true },
  }),
  loadShareEntity: async () => state.entity,
}));

beforeEach(() => {
  vi.resetModules();
  state.share = {
    id: 'share',
    name: 'Share',
    shareType: 1,
    entityId: 'site',
    parameters: { passwordHash: bcrypt.hashSync('correct', 4) },
  };
});

const context = { params: Promise.resolve({ slug: 'public-slug' }) };
const request = (password = 'wrong', address = '192.0.2.1') =>
  new Request('http://test.invalid/api/share/public-slug', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-real-ip': address },
    body: JSON.stringify({ password }),
  });

describe('bounded public share-password verification', () => {
  it('preserves the default body limit used by imports and configuration requests', async () => {
    const { readBody } = await import('@/lib/liekan/http');
    const data = { contents: 'x'.repeat(2048) };
    expect(
      await readBody(
        new Request('http://test.invalid', { method: 'POST', body: JSON.stringify(data) }),
      ),
    ).toEqual(data);
  });
  it('rejects oversized password requests before verification and cancels the stream', async () => {
    const { POST } = await import('./route');
    const cancel = vi.fn();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(JSON.stringify({ password: 'wrong', extra: 'x'.repeat(2048) })),
        );
        controller.enqueue(new TextEncoder().encode(' '));
        controller.close();
      },
      cancel,
    });
    const response = await POST(
      new Request('http://test.invalid/api/share/public-slug', {
        method: 'POST',
        body,
        duplex: 'half',
      } as RequestInit),
      context,
    );
    expect(response.status).toBe(413);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('returns 429 after five attempts and leaves the GET challenge available', async () => {
    const { GET, POST } = await import('./route');
    for (let i = 0; i < 5; i++) expect((await POST(request(), context)).status).toBe(401);
    const blocked = await POST(request(), context);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(
      await (await GET(new Request('http://test.invalid/api/share/public-slug'), context)).json(),
    ).toMatchObject({ requiresPassword: true });
  });

  it('bounds concurrent verification before starting password work', async () => {
    const { POST } = await import('./route');
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) => POST(request('wrong', `192.0.2.${i + 1}`), context)),
    );
    expect(responses.filter(response => response.status === 401)).toHaveLength(4);
    expect(responses.filter(response => response.status === 429)).toHaveLength(16);
  });

  it('keeps correct passwords and unprotected shares usable', async () => {
    const { POST } = await import('./route');
    const valid = await POST(request('correct'), context);
    expect(valid.status).toBe(200);
    expect((await valid.json()).token).toBeTruthy();
    state.share.parameters = { overview: true };
    expect((await POST(request(), context)).status).toBe(200);
  });
});
