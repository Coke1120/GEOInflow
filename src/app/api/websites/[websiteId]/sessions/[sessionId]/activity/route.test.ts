const snapshot = vi.hoisted(() => ({ active: false }));
vi.mock('@/lib/liekan/upstream/native-snapshot', () => ({
  nativeSnapshot: async (work: () => unknown) => {
    snapshot.active = true;
    try {
      return await work();
    } finally {
      snapshot.active = false;
    }
  },
}));
import { endOfMonth, startOfMonth } from 'date-fns';
import { beforeEach, expect, test, vi } from 'vitest';
import { getQueryFilters, parseRequest } from '@/lib/request';
import { canViewWebsiteSection } from '@/permissions';
import { getLinkedDistinctIds, getLinkedSessionIds, getSessionActivity } from '@/queries/sql';
import { GET } from './route';

vi.mock('@/lib/request', () => ({
  getQueryFilters: vi.fn(),
  parseRequest: vi.fn(),
}));

vi.mock('@/permissions', () => ({
  canViewWebsiteSection: vi.fn(),
}));

vi.mock('@/queries/sql', () => ({
  getLinkedDistinctIds: vi.fn(),
  getLinkedSessionIds: vi.fn(),
  getSessionActivity: vi.fn(),
}));

const parseRequestMock = vi.mocked(parseRequest);
const getQueryFiltersMock = vi.mocked(getQueryFilters);
const canViewWebsiteSectionMock = vi.mocked(canViewWebsiteSection);
const getLinkedDistinctIdsMock = vi.mocked(getLinkedDistinctIds);
const getLinkedSessionIdsMock = vi.mocked(getLinkedSessionIds);
const getSessionActivityMock = vi.mocked(getSessionActivity);

beforeEach(() => {
  parseRequestMock.mockReset();
  getQueryFiltersMock.mockReset();
  canViewWebsiteSectionMock.mockReset();
  getLinkedDistinctIdsMock.mockReset();
  getLinkedSessionIdsMock.mockReset();
  getSessionActivityMock.mockReset();
});

test('uses linked session months to widen stitched activity without scanning event bounds', async () => {
  const query = {
    startAt: +new Date('2026-07-20T23:38:54.000Z'),
    endAt: +new Date('2026-07-21T00:08:01.000Z'),
    distinctId: 'bob@aol.com',
  };
  const linkedStart = new Date('2026-05-15T12:00:00.000Z');
  const linkedEnd = new Date('2026-08-02T12:00:00.000Z');
  const filters = {
    startDate: startOfMonth(linkedStart),
    endDate: endOfMonth(linkedEnd),
  };

  parseRequestMock.mockResolvedValue({ auth: {}, query, error: undefined });
  canViewWebsiteSectionMock.mockResolvedValue(true);
  getLinkedSessionIdsMock.mockResolvedValue([
    { sessionId: 'session-2', createdAt: linkedStart.toISOString() },
    { sessionId: 'session-3', createdAt: linkedEnd.toISOString() },
  ]);
  getQueryFiltersMock.mockResolvedValue(filters);
  getSessionActivityMock.mockResolvedValue([{ eventId: 'event-1' }]);

  const response = await GET(
    new Request(
      'http://localhost/api/websites/website-1/sessions/session-1/activity?startAt=1784590734000&endAt=1784592481000&distinctId=bob%40aol.com',
    ),
    {
      params: Promise.resolve({ websiteId: 'website-1', sessionId: 'session-1' }),
    },
  );

  expect(response.status).toBe(200);
  expect(getLinkedSessionIdsMock).toHaveBeenCalledWith('website-1', 'bob@aol.com');
  expect(getQueryFiltersMock).toHaveBeenCalledWith(
    {
      ...query,
      startAt: +startOfMonth(linkedStart),
      endAt: +endOfMonth(linkedEnd),
    },
    'website-1',
  );
  expect(getSessionActivityMock).toHaveBeenCalledWith(
    'website-1',
    ['session-1', 'session-2', 'session-3'],
    filters,
  );
  await expect(response.json()).resolves.toEqual([{ eventId: 'event-1' }]);
});

test('keeps activity scoped to the raw session when multiple identities are linked', async () => {
  const query = {
    startAt: +new Date('2026-07-20T23:38:54.000Z'),
    endAt: +new Date('2026-07-21T00:08:01.000Z'),
  };
  const filters = { startDate: new Date(query.startAt), endDate: new Date(query.endAt) };

  parseRequestMock.mockResolvedValue({ auth: {}, query, error: undefined });
  canViewWebsiteSectionMock.mockResolvedValue(true);
  getLinkedDistinctIdsMock.mockResolvedValue(['distinct-1', 'distinct-2']);
  getQueryFiltersMock.mockResolvedValue(filters);
  getSessionActivityMock.mockResolvedValue([{ eventId: 'event-1' }]);

  await GET(
    new Request(
      'http://localhost/api/websites/website-1/sessions/session-1/activity?startAt=1784590734000&endAt=1784592481000',
    ),
    {
      params: Promise.resolve({ websiteId: 'website-1', sessionId: 'session-1' }),
    },
  );

  expect(getLinkedSessionIdsMock).not.toHaveBeenCalled();
  expect(getSessionActivityMock).toHaveBeenCalledWith('website-1', ['session-1'], filters);
});

test('selects linked identities and their activity inside the same reporting snapshot', async () => {
  parseRequestMock.mockResolvedValue({
    auth: {},
    query: { startAt: 1000, endAt: 2000 },
    error: undefined,
  });
  canViewWebsiteSectionMock.mockResolvedValue(true);
  getQueryFiltersMock.mockResolvedValue({ startDate: new Date(1000), endDate: new Date(2000) });
  getLinkedDistinctIdsMock.mockImplementation(async () => {
    expect(snapshot.active).toBe(true);
    return ['trusted'];
  });
  getLinkedSessionIdsMock.mockImplementation(async () => {
    expect(snapshot.active).toBe(true);
    return [];
  });
  getSessionActivityMock.mockImplementation(async () => {
    expect(snapshot.active).toBe(true);
    return [{ eventId: 'event-1' }];
  });
  const result = await GET(
    new Request('https://synthetic.test/api/websites/site/sessions/session-1/activity'),
    { params: Promise.resolve({ websiteId: 'site', sessionId: 'session-1' }) },
  );
  expect(await result.json()).toEqual([{ eventId: 'event-1' }]);
  expect(snapshot.active).toBe(false);
});
