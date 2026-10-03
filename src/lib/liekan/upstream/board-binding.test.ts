import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  board: null as any,
  share: null as any,
  websites: new Map<string, any>(),
  user: { id: 'owner', username: 'owner', role: 'user', isAdmin: false },
}));
vi.mock('@/lib/auth', () => ({
  checkAuth: async () => ({ user: state.user }),
  hasPermission: () => false,
}));
vi.mock('@/lib/load', () => ({ fetchWebsite: vi.fn(), fetchAccount: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  default: {
    client: {
      board: { findFirst: ({ where }: any) => (state.board?.id === where.id ? state.board : null) },
      website: { findFirst: ({ where }: any) => state.websites.get(where.id) ?? null },
      user: { findFirst: () => state.user },
      teamUser: { findFirst: () => null },
    },
  },
  getRawQueryClient: (client: any) => client,
}));
vi.mock('@/queries/prisma', () => ({
  getBoard: async (id: string) => (state.board?.id === id ? state.board : null),
  getWebsite: async (id: string) => state.websites.get(id) ?? null,
  getLink: async () => null,
  getPixel: async () => null,
  getTeamUser: async () => null,
  getReport: async () => null,
  getWebsiteSegment: async () => null,
  getShare: async () => state.share,
  updateBoard: async (_id: string, data: any) => {
    state.board = {
      ...state.board,
      ...Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)),
    };
    return state.board;
  },
}));
vi.mock('@/permissions', async () => import('@/permissions/board'));

import { GET, POST } from '@/app/api/boards/[boardId]/route';
import { getBoardEntityIds } from '@/lib/boards';
import { ENTITY_TYPE } from '@/lib/constants';
import { boardParameters } from '../contracts/workspace';
import { currentShareScope, validateLiveShare } from './live-share';

beforeEach(() => {
  state.share = null;
  state.websites = new Map([
    ['site-a', { id: 'site-a', userId: 'owner' }],
    ['site-b', { id: 'site-b', userId: 'owner' }],
  ]);
  state.board = {
    id: 'board',
    type: 'website',
    userId: 'owner',
    parameters: {
      websiteId: 'site-a',
      rows: [
        {
          id: 'row',
          columns: [
            {
              id: 'column',
              component: {
                type: 'WebsiteChart',
                title: 'Traffic',
                entityType: 'website',
                entityId: 'site-a',
                websiteId: 'site-a',
              },
            },
          ],
        },
      ],
    },
  };
});

describe('board source authorization regression', () => {
  it('an upgraded raw fixed board scopes new and existing share tokens to B before any resave', async () => {
    state.board.parameters.websiteId = 'site-b';
    const original = structuredClone(state.board);
    const response = await GET(new Request('http://localhost/api/boards/board'), {
      params: Promise.resolve({ boardId: 'board' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(original);
    state.share = {
      id: 'share',
      shareType: ENTITY_TYPE.board,
      entityId: 'board',
      parameters: { overview: true },
    };
    const scope = await currentShareScope(state.share);
    expect(scope).toMatchObject({
      boardId: 'board',
      websiteIds: ['site-b'],
      pixelIds: [],
      linkIds: [],
    });
    expect(await validateLiveShare({ ...scope, websiteIds: ['site-a', 'site-b'] })).toMatchObject({
      boardId: 'board',
      websiteIds: ['site-b'],
    });
    expect(state.board).toEqual(original);
  });

  it('a raw upgraded fixed board remains editable after access to the unused source is lost', async () => {
    state.board.parameters.websiteId = 'site-b';
    state.websites.set('site-a', { id: 'site-a', userId: 'someone-else' });
    const response = await POST(
      new Request('http://localhost/api/boards/board', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed', parameters: state.board.parameters }),
      }),
      { params: Promise.resolve({ boardId: 'board' }) },
    );
    expect(response.status).toBe(200);
    const saved = await response.json();
    expect(saved.parameters.rows[0].columns[0].component.entityId).toBe('site-a');
    expect(getBoardEntityIds(saved)).toEqual({ websiteIds: ['site-b'], linkIds: [], pixelIds: [] });
  });

  it('a regular owner can save after rebinding to B and losing access to A', async () => {
    const parameters = boardParameters(
      state.board.parameters,
      'website',
      'site-b',
      state.board.type,
    );
    state.websites.set('site-a', { id: 'site-a', userId: 'someone-else' });
    const response = await POST(
      new Request('http://localhost/api/boards/board', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'website', parameters }),
      }),
      { params: Promise.resolve({ boardId: 'board' }) },
    );
    expect(response.status).toBe(200);
    const saved = await response.json();
    expect(getBoardEntityIds(saved)).toEqual({ websiteIds: ['site-b'], linkIds: [], pixelIds: [] });
    expect(saved.parameters.rows).toHaveLength(1);
  });

  it('a new share scope grants only B after fixed-source rebinding even while A is still owned', async () => {
    state.board.parameters = boardParameters(
      state.board.parameters,
      'website',
      'site-b',
      state.board.type,
    );
    state.share = {
      id: 'share',
      shareType: ENTITY_TYPE.board,
      entityId: 'board',
      parameters: { overview: true },
    };
    const scope = await currentShareScope(state.share);
    expect(scope).toMatchObject({
      boardId: 'board',
      websiteIds: ['site-b'],
      pixelIds: [],
      linkIds: [],
    });
    expect(await validateLiveShare({ ...scope, websiteIds: ['site-a', 'site-b'] })).toMatchObject({
      boardId: 'board',
      websiteIds: ['site-b'],
    });
  });
});
