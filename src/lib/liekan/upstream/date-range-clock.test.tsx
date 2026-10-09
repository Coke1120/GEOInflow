import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useFeatureDateRange } from './client';
import { featureDateRange } from '@/lib/liekan/contracts/analysis';

const state = vi.hoisted(() => ({ query: { date: '0day' } as Record<string, string> }));
vi.mock('@/components/hooks/useNavigation', () => ({ useNavigation: () => state }));
vi.mock('@/components/hooks/useLocale', () => ({ useLocale: () => ({ locale: 'zh-CN' }) }));
let visibility = 'visible';
beforeEach(() => {
  vi.useFakeTimers();
  state.query = { date: '0day' };
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility as any);
});
afterEach(() => vi.useRealTimers());
it.each(['0day', '7day', '30day'])('holds %s at the selected timezone midnight', async date => {
  state.query = { date };
  vi.setSystemTime(new Date('2026-10-05T15:59:59Z'));
  const { result } = renderHook(() => useFeatureDateRange('Asia/Shanghai'));
  const start = +result.current.dateRange.startDate;
  const end = +result.current.dateRange.endDate;
  await act(async () => vi.advanceTimersByTimeAsync(1001));
  expect(+result.current.dateRange.startDate).toBe(start);
  expect(+result.current.dateRange.endDate).toBe(end);
});
it('waits for UTC midnight independently of Shanghai midnight', async () => {
  vi.setSystemTime(new Date('2026-10-05T15:59:59Z'));
  const { result } = renderHook(() => useFeatureDateRange('UTC'));
  const end = +result.current.dateRange.endDate;
  await act(async () => vi.advanceTimersByTimeAsync(1001));
  expect(+result.current.dateRange.endDate).toBe(end);
});
it('preserves the calendar on visibility restoration', async () => {
  vi.setSystemTime(new Date('2026-10-05T15:59:59Z'));
  const { result } = renderHook(() => useFeatureDateRange('Asia/Shanghai'));
  const end = +result.current.dateRange.endDate;
  visibility = 'hidden';
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await act(async () => vi.advanceTimersByTimeAsync(86400001));
  expect(+result.current.dateRange.endDate).toBe(end);
  visibility = 'visible';
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(+result.current.dateRange.endDate).toBe(end);
});
it('preserves an explicitly selected range across midnight and restored visibility', async () => {
  state.query = { date: 'range:123:987:day' };
  vi.setSystemTime(new Date('2026-10-05T15:59:59Z'));
  const { result } = renderHook(() => useFeatureDateRange('Asia/Shanghai'));
  await act(async () => vi.advanceTimersByTimeAsync(86400001));
  act(() => window.dispatchEvent(new Event('focus')));
  expect(+result.current.dateRange.startDate).toBe(123);
  expect(+result.current.dateRange.endDate).toBe(987);
});
it('preserves the calendar across a daylight-saving boundary', async () => {
  vi.setSystemTime(new Date('2026-11-01T03:59:59Z'));
  const { result } = renderHook(() => useFeatureDateRange('America/New_York'));
  const end = featureDateRange(result.current.dateRange, 'America/New_York').endAt;
  await act(async () => vi.advanceTimersByTimeAsync(1001));
  expect(featureDateRange(result.current.dateRange, 'America/New_York').endAt).toBe(end);
});
