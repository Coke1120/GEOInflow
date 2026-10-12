import { expect, it, vi } from 'vitest';
import { pageReportQuery } from './page-report-client';
import { featureApi } from './features-client';
it('preserves the owner key slot and gives keyword conditions and snapshots separate identities', () => {
  const input = { resource: 'human/keywords' as const, startAt: 0, endAt: 1, timezone: 'UTC' };
  const initial = pageReportQuery('owner', 'site', input);
  expect(initial.queryKey[14]).toBe('owner');
  for (const change of [
    { engine: 'Google' as const },
    { evidence: 'utm' as const },
    { status: 'missing' as const },
    { sort: 'keyword' as const },
    { direction: 'asc' as const },
    { keywordSnapshot: 'changed' },
    { search: 'term' },
    { page: 2 },
  ]) {
    const next = pageReportQuery('owner', 'site', { ...input, ...change });
    expect(next.queryKey).not.toEqual(initial.queryKey);
    expect(next.queryKey[14]).toBe('owner');
  }
  expect(
    pageReportQuery('owner', 'site', { ...input, resource: 'human/sources' }).queryKey,
  ).toHaveLength(15);
  expect(initial.refetchOnWindowFocus).toBe(false);
  expect(initial.refetchOnReconnect).toBe(false);
});
it('declares the new status capability only on keyword requests and separates the legacy client cache', async () => {
  const get = vi.spyOn(featureApi, 'get').mockResolvedValue({});
  try {
    const input = { resource: 'human/keywords' as const, startAt: 0, endAt: 1, timezone: 'UTC' };
    const options = pageReportQuery('owner', 'site', input);
    const oldKey = [...options.queryKey];
    oldKey[15] = JSON.stringify(['', '', '', 'sessions', 'desc', '']);
    expect(options.queryKey).not.toEqual(oldKey);
    await options.queryFn({ signal: new AbortController().signal });
    expect(get.mock.calls[0][1]).toMatchObject({ keywordStatusVersion: '2' });
    await pageReportQuery('owner', 'site', { ...input, resource: 'human/sources' }).queryFn({
      signal: new AbortController().signal,
    });
    expect(get.mock.calls[1][1]).not.toHaveProperty('keywordStatusVersion');
  } finally {
    get.mockRestore();
  }
});
