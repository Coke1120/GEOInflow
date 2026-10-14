import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { LiekanLocaleContext } from '@/lib/liekan/i18n/client';
import { Exports } from './Exports';

const mocks = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock('@/lib/liekan/upstream/features-client', () => ({ streamFeatureExport: mocks.stream }));
vi.mock('./context', () => ({
  useFeature: () => ({
    siteId: '1',
    sites: [{ id: 'fixture-website', siteNumber: 1, name: '客户原名' }],
    range: { startAt: 0, endAt: 1000, timezone: 'UTC' },
    filters: { country: 'eq.CN' },
  }),
}));

it('captures the standard export locale at submission and keeps the pending request across a language toggle', async () => {
  let reject!: (error: Error) => void;
  let signal!: AbortSignal;
  mocks.stream.mockImplementationOnce((_website, _body, abort: AbortSignal) => {
    signal = abort;
    return new Promise((_resolve, no) => {
      reject = no;
    });
  });
  const view = render(
    <LiekanLocaleContext.Provider value="en-US">
      <Exports />
    </LiekanLocaleContext.Provider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Generate export file' }));
  expect(mocks.stream).toHaveBeenCalledTimes(1);
  expect(mocks.stream.mock.calls[0].slice(0, 2)).toEqual([
    'fixture-website',
    {
      startAt: 0,
      endAt: 86399999,
      timezone: 'UTC',
      format: 'zip',
      sections: ['summary', 'dimensions', 'events', 'config'],
      filters: { country: 'eq.CN' },
      locale: 'en-US',
    },
  ]);
  view.rerender(
    <LiekanLocaleContext.Provider value="zh-CN">
      <Exports />
    </LiekanLocaleContext.Provider>,
  );
  expect(signal.aborted).toBe(false);
  expect(mocks.stream).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '取消导出' })).toBeEnabled();
  await act(async () => reject(new Error('fixture failure')));
});
