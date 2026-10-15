import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CrawlerCandidatesPanel } from './CrawlerCandidatesPanel';
import { CrawlerSourcesPanel } from './CrawlerSourcesPanel';
import { LiekanLocaleContext } from '@/lib/liekan/i18n/client';
const h = vi.hoisted(() => ({
  get: vi.fn(),
  admin: false,
  query: {} as any,
  enabled: [] as boolean[],
}));
vi.mock('@/lib/liekan/upstream/client', () => ({ useApi: () => ({ get: h.get }) }));
vi.mock('./context', () => ({
  useFeature: () => ({
    user: { id: 'fixture', isAdmin: h.admin },
    api: { get: h.get },
    range: { timezone: 'UTC' },
  }),
  useData: (_key: unknown, _load: unknown, enabled: boolean) => {
    h.enabled.push(enabled);
    return h.query;
  },
}));
const result = {
  state: 'ready',
  windowStart: '2026-10-08T00:00:00Z',
  windowEnd: '2026-10-15T00:00:00Z',
  scannedRows: 100000,
  scanLimit: 100000,
  partial: true,
  scannedStart: '2026-10-10T00:00:00Z',
  scannedEnd: '2026-10-14T00:00:00Z',
  items: [
    {
      token: 'FixtureCrawler',
      count: 4,
      firstSeen: '2026-10-10T00:00:00Z',
      lastSeen: '2026-10-14T00:00:00Z',
    },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
  h.admin = false;
  h.enabled = [];
  h.query = {};
  h.get.mockResolvedValue(result);
});
it('queries candidates only on demand and distinguishes partial samples and read failures', async () => {
  render(<CrawlerCandidatesPanel websiteId="a" />);
  expect(h.get).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '查看未知名称候选' }));
  expect(await screen.findByText('FixtureCrawler')).toBeVisible();
  expect(screen.getByText(/部分样本：/)).toBeVisible();
  h.get.mockRejectedValueOnce(Object.assign(new Error('denied'), { status: 403 }));
  fireEvent.click(screen.getByRole('button', { name: '查看未知名称候选' }));
  expect(await screen.findByText('本次候选查询未完成，请稍后重试。')).toBeVisible();
  expect(screen.queryByText('FixtureCrawler')).toBeNull();
});
it('drops a late candidate response after switching websites', async () => {
  let resolve!: (value: any) => void;
  h.get.mockImplementationOnce(
    () =>
      new Promise(done => {
        resolve = done;
      }),
  );
  const view = render(<CrawlerCandidatesPanel websiteId="a" />);
  fireEvent.click(screen.getByRole('button', { name: '查看未知名称候选' }));
  const signal = h.get.mock.calls[0][3];
  view.rerender(<CrawlerCandidatesPanel websiteId="b" />);
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(result));
  expect(screen.queryByText('FixtureCrawler')).toBeNull();
});
it('never enables platform source queries for regular website users', () => {
  const view = render(<CrawlerSourcesPanel />);
  expect(h.enabled).toEqual([false]);
  expect(view.container).toBeEmptyDOMElement();
});
it('renders source failure and expiry states in English and hides stale data after permission errors', () => {
  h.admin = true;
  h.query = {
    data: {
      catalogVersion: 'fixture-version',
      documents: [],
      ipSources: [
        {
          id: 'fixture',
          url: 'https://example.com/feed',
          names: ['FixtureBot'],
          crawlerIds: ['fixture'],
          reviewedAt: '2026-10-01',
          version: 'a'.repeat(64),
          candidateVersion: null,
          lastSuccessAt: null,
          lastAttemptAt: null,
          nextCheckAt: null,
          consecutiveFailures: 4,
          errorCode: 'http_403',
          status: 'stale',
          reviewOverdue: true,
        },
      ],
    },
    refetch: vi.fn(),
  };
  const view = render(
    <LiekanLocaleContext.Provider value="en-US">
      <CrawlerSourcesPanel />
    </LiekanLocaleContext.Provider>,
  );
  expect(screen.getByText('Evidence expired')).toBeVisible();
  expect(screen.getByText('Manual review is over 45 days old')).toBeVisible();
  expect(screen.getByRole('link', { name: 'FixtureBot' })).toHaveAttribute(
    'href',
    'https://example.com/feed',
  );
  h.query.error = new Error('forbidden');
  view.rerender(
    <LiekanLocaleContext.Provider value="en-US">
      <CrawlerSourcesPanel />
    </LiekanLocaleContext.Provider>,
  );
  expect(screen.queryByText('FixtureBot')).toBeNull();
  expect(screen.getByText('Unable to load source status. Please retry.')).toBeVisible();
});
