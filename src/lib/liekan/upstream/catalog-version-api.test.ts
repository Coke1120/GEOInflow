// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ auth: vi.fn(), allowed: vi.fn(), relational: vi.fn(), bind: vi.fn() }));
vi.mock('@/lib/auth', () => ({ checkAuth: h.auth }));
vi.mock('@/lib/db', () => ({ isRelationalOnly: h.relational }));
vi.mock('@/permissions', () => ({ canViewWebsite: h.allowed, canViewBoard: h.allowed, canViewLink: h.allowed, canViewPixel: h.allowed }));
vi.mock('@/lib/liekan/http', () => ({ api: async (work: () => unknown) => { h.bind(); return Response.json(await work()); } }));
vi.mock('../crawlers/published', () => ({ getPublishedCatalog: () => ({ version: '96074773-f17b-46e9-9af5-b09bca5e4281' }) }));
import { GET } from '@/app/api/liekan/catalog-version/route';
import { ENTITY_TYPE } from '@/lib/constants';
const request = () => new Request('https://site.test/api/liekan/catalog-version');
beforeEach(() => { vi.clearAllMocks(); h.relational.mockReturnValue(true); h.allowed.mockResolvedValue(true); h.auth.mockResolvedValue({ authType: 'session', user: { id: 'owner' } }); });
it.each([ENTITY_TYPE.website,ENTITY_TYPE.board,ENTITY_TYPE.link,ENTITY_TYPE.pixel])('checks live permission for share type %s', async shareType => {
 h.auth.mockResolvedValue({ shareToken: { shareType, websiteId: 'site', boardId:'board',linkId:'link',pixelId:'pixel' } });
 expect((await GET(request())).status).toBe(200);expect(h.allowed).toHaveBeenCalledOnce();
 h.allowed.mockResolvedValue(false);expect((await GET(request())).status).toBe(403);
});
it.each(['partial','api-key',undefined])('rejects incomplete or non-session identities %s', async authType => {
 h.auth.mockResolvedValue({ authType, user: { id:'owner' } }); expect((await GET(request())).status).toBe(401);expect(h.bind).not.toHaveBeenCalled();
});
it('keeps non-PostgreSQL native requests independent of the PostgreSQL registry', async () => {
 h.relational.mockReturnValue(false);const response=await GET(request());expect(await response.json()).toEqual({version:null});expect(h.bind).not.toHaveBeenCalled();
});
it('rejects mixed private and public identities at the server boundary', async () => {
 h.auth.mockResolvedValue({authType:'session',user:{id:'owner'},shareToken:{shareType:ENTITY_TYPE.website,websiteId:'site'}});
 expect((await GET(request())).status).toBe(403);expect(h.allowed).not.toHaveBeenCalled();expect(h.bind).not.toHaveBeenCalled();
});
