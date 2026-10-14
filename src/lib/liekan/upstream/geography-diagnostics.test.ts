// @vitest-environment node
import { expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ facts: vi.fn(), snapshot: vi.fn() }));
vi.mock('@/lib/detect', () => ({ geographyAttribution: vi.fn() }));
vi.mock('@/lib/clickhouse', () => ({ default: { enabled: false } }));
vi.mock('@/lib/ip', () => ({ ipConfigurationStatus: () => ({}) }));
vi.mock('../geography/bundle', () => ({
  geographyBundle: vi.fn(),
  geographyRuntimeStatus: () => ({}),
}));
vi.mock('./analytics', () => ({ getHumanFacts: mocks.facts }));
vi.mock('./server', async () => ({
  ...(await import('./errors')),
  query: vi.fn(async () => []),
  reportSnapshot: mocks.snapshot,
}));
import { geographyDiagnostics } from './geography-diagnostics';
import { analyticsGate } from './analytics-budget';

test('diagnostics shares the analytics gate, deadline and bounded fact payload', async () => {
  let release: () => void;
  const hold = new Promise<void>(resolve => {
    release = resolve;
  });
  let active = 0,
    maximum = 0;
  mocks.facts.mockResolvedValue({ geo: [], totals: { visits: 0 } });
  mocks.snapshot.mockImplementation(async work => {
    maximum = Math.max(maximum, ++active);
    try {
      await hold;
      return await work();
    } finally {
      active--;
    }
  });
  const requests = Array.from({ length: 64 }, () =>
    geographyDiagnostics('fixture', new URLSearchParams()).then(
      value => ({ value }),
      error => ({ error }),
    ),
  );
  try {
    await vi.waitFor(() => expect(mocks.snapshot.mock.calls.length).toBeGreaterThanOrEqual(2));
  } finally {
    release();
  }
  const results = await Promise.all(requests);
  expect(maximum).toBeLessThanOrEqual(2);
  expect(results.some(result => 'error' in result && result.error.status === 503)).toBe(true);
  expect(results.some(result => 'value' in result && result.value.available)).toBe(true);
  expect(
    mocks.snapshot.mock.calls.every(
      ([, deadline]) => Number.isFinite(deadline) && deadline > Date.now() - 60000,
    ),
  ).toBe(true);
  expect(
    mocks.facts.mock.calls.every(
      call => call[5]?.rows === 100000 && call[5]?.bytes === 50 * 1024 * 1024,
    ),
  ).toBe(true);
  expect(analyticsGate.state).toEqual({ active: 0, queued: 0 });
});
