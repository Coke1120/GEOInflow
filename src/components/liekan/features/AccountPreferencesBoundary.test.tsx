import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { setAccountPreferences } from '@/store/app';
import { defaultAccountPreferences } from '@/lib/liekan/contracts/account-preferences';
import { AccountPreferencesBoundary } from './AccountPreferencesBoundary';
import { getFeaturePreferences } from '@/lib/liekan/upstream/features-client';

const h = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), child: vi.fn() }));
vi.mock('@/lib/liekan/upstream/account-preferences-client', async original => ({
  ...(await original<typeof import('@/lib/liekan/upstream/account-preferences-client')>()),
  loadAccountPreferences: h.load,
  saveAccountPreferences: h.save,
}));
vi.mock('../LanguageSelector', () => ({ LanguageSelector: () => null }));
function Analytics() {
  h.child(getFeaturePreferences());
  return <div>analytics-ready</div>;
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  setAccountPreferences(null);
});

it('waits for account preferences before mounting analytics with a different browser timezone', async () => {
  let resolve: () => void;
  h.load.mockImplementation(
    () =>
      new Promise<void>(yes => {
        resolve = yes;
      }),
  );
  render(
    <AccountPreferencesBoundary>
      <Analytics />
    </AccountPreferencesBoundary>,
  );
  expect(h.child).not.toHaveBeenCalled();
  await act(async () => {
    setAccountPreferences({
      ...defaultAccountPreferences,
      countryCode: 'JP',
      timezone: 'Asia/Tokyo',
      range: '7day',
      configured: true,
    });
    resolve();
  });
  expect(await screen.findByText('analytics-ready')).toBeInTheDocument();
  expect(h.child).toHaveBeenCalledWith(
    expect.objectContaining({ timezone: 'Asia/Tokyo', range: '7day' }),
  );
});
it('requires an explicit city for a multi-zone country and mounts statistics after confirmation', async () => {
  h.load.mockImplementation(async () => {
    setAccountPreferences(defaultAccountPreferences);
  });
  h.save.mockImplementation(async values => {
    setAccountPreferences({ ...defaultAccountPreferences, ...values, configured: true });
  });
  render(
    <AccountPreferencesBoundary>
      <Analytics />
    </AccountPreferencesBoundary>,
  );
  const country = await screen.findByLabelText('国家或地区');
  expect(h.child).not.toHaveBeenCalled();
  fireEvent.change(country, { target: { value: 'US' } });
  const timezone = screen.getByLabelText('分析时区');
  expect(timezone).toHaveValue('');
  fireEvent.change(timezone, { target: { value: 'America/Los_Angeles' } });
  fireEvent.click(screen.getByRole('button', { name: '确认并继续' }));
  await waitFor(() =>
    expect(h.save).toHaveBeenCalledWith({
      countryCode: 'US',
      timezone: 'America/Los_Angeles',
      range: '0day',
    }),
  );
  expect(await screen.findByText('analytics-ready')).toBeInTheDocument();
});
it('keeps analytics blocked on a preference load failure and offers retry', async () => {
  h.load.mockRejectedValueOnce(new Error('temporary')).mockImplementation(async () => {
    setAccountPreferences({ ...defaultAccountPreferences, configured: true });
  });
  render(
    <AccountPreferencesBoundary>
      <Analytics />
    </AccountPreferencesBoundary>,
  );
  expect(await screen.findByText('temporary')).toBeInTheDocument();
  expect(h.child).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(await screen.findByText('analytics-ready')).toBeInTheDocument();
});
