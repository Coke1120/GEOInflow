import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  share: null as any,
  board: null as any,
  website: null as any,
  user: { id: 'owner', role: 'user' },
  replica: vi.fn(),
}));
vi.mock('@/lib/prisma', () => {
  const primary = {
    share: { findUnique: vi.fn(() => state.share) },
    board: { findFirst: vi.fn(() => state.board) },
    website: { findFirst: vi.fn(() => state.website) },
    pixel: { findFirst: vi.fn(() => null) },
    link: { findFirst: vi.fn(() => null) },
    user: { findFirst: vi.fn(() => state.user) },
    team: { findFirst: vi.fn(() => null) },
    teamUser: { findMany: vi.fn(() => []), findFirst: vi.fn(() => null) },
  };
  const client = { share: { findUnique: state.replica }, $primary: () => primary };
  return { default: { client }, getRawQueryClient: (c: any) => c.$primary() };
});
vi.mock('./server', () => ({
  LiekanError: class extends Error {
    constructor(
      message: string,
      public status = 400,
    ) {
      super(message);
    }
  },
}));
vi.mock('@/queries/prisma', async () => ({
  getShare: (await import('@/queries/prisma/share')).getShare,
}));
import { ENTITY_TYPE } from '@/lib/constants';
import { validateLiveShare } from './live-share';
import { secureShareParameters, sharePasswordProof } from './share-security';
import { getShareByCode } from '@/queries/prisma/share';
import { getBundledPublishedCatalog } from '../crawlers/catalog-seed';
import { installPublishedCatalogResolver } from '../crawlers/published';
describe('current primary share authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.share = {
      id: 'share',
      entityId: 'site',
      shareType: ENTITY_TYPE.website,
      parameters: { overview: true },
    };
    state.website = { id: 'site', userId: 'owner' };
    state.board = null;
  });
  it('ignores a stale replica and revokes disabled, removed and password changed shares', async () => {
    const token = { shareId: 'share', websiteId: 'site', shareType: ENTITY_TYPE.website };
    expect(await validateLiveShare(token)).toMatchObject({ websiteId: 'site' });
    await getShareByCode('slug');
    expect(state.replica).not.toHaveBeenCalled();
    state.share.parameters.enabled = false;
    expect(await validateLiveShare(token)).toBeNull();
    state.share.parameters = secureShareParameters({ password: 'example' });
    expect(await validateLiveShare(token)).toBeNull();
    expect(
      await validateLiveShare({
        ...token,
        passwordProof: sharePasswordProof(state.share.parameters),
      }),
    ).toBeTruthy();
    state.share = null;
    expect(await validateLiveShare(token)).toBeNull();
  });
  it('intersects board resources with the issued token and current ownership', async () => {
    state.share = {
      id: 'share',
      entityId: 'board',
      shareType: ENTITY_TYPE.board,
      parameters: { overview: true },
    };
    state.board = {
      id: 'board',
      type: 'website',
      userId: 'owner',
      parameters: { websiteId: 'site', rows: [] },
    };
    const token = {
      shareId: 'share',
      boardId: 'board',
      shareType: ENTITY_TYPE.board,
      websiteIds: ['site'],
    };
    expect(await validateLiveShare(token)).toMatchObject({ websiteIds: ['site'] });
    state.board.parameters.websiteId = 'new-site';
    expect(await validateLiveShare(token)).toMatchObject({ websiteIds: [] });
    state.board.parameters.websiteId = 'site';
    state.website.userId = 'another';
    expect(await validateLiveShare(token)).toMatchObject({ websiteIds: [] });
  });
  it('keeps board layout authorization stable across catalog versions', async () => {
    state.share = { id: 'share', entityId: 'board', shareType: ENTITY_TYPE.board, parameters: { overview: true } };
    state.board = { id: 'board', type: 'website', userId: 'owner', parameters: { websiteId: 'site', rows: [] } };
    const token = { shareId: 'share', boardId: 'board', shareType: ENTITY_TYPE.board, websiteIds: ['site'] };
    try {
      const original = await validateLiveShare(token);
      installPublishedCatalogResolver(() => getBundledPublishedCatalog());
      expect((await validateLiveShare(token)).boardLayoutHash).toBe(original.boardLayoutHash);
      state.board.parameters.rows = [{ id: 'new-layout-row' }];
      expect((await validateLiveShare(token)).boardLayoutHash).not.toBe(original.boardLayoutHash);
    } finally {
      installPublishedCatalogResolver(() => undefined);
    }
  });
});
