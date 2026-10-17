import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import type { CrawlerIdentityScope } from '@/lib/liekan/contracts/crawler-metrics';
import { TrafficEvidencePanel } from './TrafficEvidencePanel';

const mocks = vi.hoisted(() => ({ request: vi.fn(), download: vi.fn() }));
vi.mock('@/lib/liekan/upstream/features-client', () => ({
  featureRequest: mocks.request,
  downloadTrafficEvidence: mocks.download,
}));
const range = { startAt: 1792022400000, endAt: 1792108800000, timezone: 'UTC' };
const websiteId = '12345678-1234-4234-8234-123456789012';
function Harness() {
  const [scope, setScope] = useState<CrawlerIdentityScope>('all');
  return (
    <>
      <select
        aria-label="test scope"
        value={scope}
        onChange={e => setScope(e.target.value as CrawlerIdentityScope)}
      >
        <option value="all">All</option>
        <option value="verified_range">Verified</option>
      </select>
      <TrafficEvidencePanel
        websiteId={websiteId}
        hostname="example.com"
        range={range}
        identityScope={scope}
        onIdentityScope={setScope}
      />
    </>
  );
}
beforeEach(() => {
  mocks.request.mockReset();
  mocks.request.mockImplementation(async (_method, _path, query) => ({
    meta: {
      sources: [],
      snapshot: 'a'.repeat(64),
      policySnapshot: 'b'.repeat(64),
      readAt: new Date(range.endAt).toISOString(),
      conditions: query,
      quality: { state: 'unknown' },
      page: 1,
      total: 1,
    },
    rows:
      query.view === 'requests'
        ? [{ time: '2026-10-15', path: '/record', method: 'GET', status: 200, bot: 'GPTBot' }]
        : [
            { identity: 'unverified', response: '2xx', requests: 3 },
            { identity: 'verified_range', response: '2xx', requests: 5 },
          ],
    ...(query.view === 'requests'
      ? {}
      : {
          totals: { requests: 8 },
          reasons: [],
          coverage: { value: null },
          ambiguousRequests: 0,
        }),
    outsideScope:
      query.crawlerIdentityScope === 'verified_range'
        ? [{ identity: 'unverified', response: '2xx', requests: 3 }]
        : [],
  }));
});
it('returns from a request response to the matrix without rendering the old response shape', async () => {
  render(<Harness />);
  fireEvent.click(await screen.findByRole('button', { name: '未核验 2xx' }));
  fireEvent.click(await screen.findByRole('button', { name: '返回身份矩阵' }));
  expect(await screen.findByRole('button', { name: '未核验 2xx' })).toHaveTextContent('3');
  expect(screen.queryByText('/record')).not.toBeInTheDocument();
});
it('clears a drilled identity when the outer identity scope changes, including when switched back', async () => {
  render(<Harness />);
  fireEvent.click(await screen.findByRole('button', { name: '未核验 2xx' }));
  await screen.findByRole('button', { name: '返回身份矩阵' });
  expect(mocks.request.mock.calls.at(-1)[2]).toMatchObject({
    view: 'requests',
    verificationGroup: 'unverified',
  });
  mocks.request.mockClear();
  fireEvent.change(screen.getByLabelText('test scope'), { target: { value: 'verified_range' } });
  await screen.findByRole('button', { name: '官方范围匹配 2xx' });
  expect(mocks.request.mock.calls.every(([, , q]) => !q.verificationGroup)).toBe(true);
  expect(mocks.request.mock.calls.at(-1)[2].crawlerIdentityScope).toBe('verified_range');
  fireEvent.change(screen.getByLabelText('test scope'), { target: { value: 'all' } });
  await screen.findByRole('button', { name: '未核验 2xx' });
  expect(screen.queryByRole('button', { name: '返回身份矩阵' })).not.toBeInTheDocument();
});
it('preserves the explicit outside-scope shortcut while widening to all identities', async () => {
  render(<Harness />);
  await screen.findByRole('button', { name: '未核验 2xx' });
  fireEvent.change(screen.getByLabelText('test scope'), { target: { value: 'verified_range' } });
  await screen.findByText('范围外参考');
  fireEvent.click(screen.getByText('范围外参考'));
  fireEvent.click(screen.getByRole('button', { name: /切换到全部声明查看/ }));
  await screen.findByRole('button', { name: '返回身份矩阵' });
  await waitFor(() =>
    expect(mocks.request.mock.calls.at(-1)[2]).toMatchObject({
      crawlerIdentityScope: 'all',
      view: 'requests',
      verificationGroup: 'unverified',
      responseGroup: '2xx',
    }),
  );
  expect(screen.getByLabelText('test scope')).toHaveValue('all');
});
