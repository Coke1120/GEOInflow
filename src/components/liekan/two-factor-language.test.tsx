import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, expect, it, vi } from 'vitest';
import { useLocale } from '@/components/hooks/useLocale';
import { TwoFactorSetupModal } from '@/components/modals/TwoFactorSetupModal';
import { TwoFactorSuccessModal } from '@/components/modals/TwoFactorSuccessModal';
import { LiekanLocaleContext } from '@/lib/liekan/i18n/client';
import { useApp } from '@/store/app';
import english from '../../../public/intl/messages/en-US.json';
import chinese from '../../../public/intl/messages/zh-CN.json';

const mocks = vi.hoisted(() => ({ initiate: vi.fn(), confirm: vi.fn(), cancel: vi.fn() }));
vi.mock('@/components/hooks', async () => ({
  ...(await import('@/components/hooks/useMessages')),
  useUpdateQuery: (path: string) => ({
    mutate: path.endsWith('initiate') ? mocks.initiate : mocks.cancel,
    mutateAsync: mocks.confirm,
    isPending: false,
  }),
}));
vi.mock('@/components/common/OtpInput', () => ({
  OtpInput: ({ value, onChange, disabled }) => (
    <input
      aria-label="Verification code"
      value={value}
      disabled={disabled}
      onChange={event => onChange(event.target.value)}
    />
  ),
}));

function Languages({ children }: { children: React.ReactNode }) {
  const { locale } = useLocale();
  return (
    <NextIntlClientProvider locale={locale} messages={locale === 'en-US' ? english : chinese}>
      <LiekanLocaleContext.Provider value={locale === 'en-US' ? 'en-US' : 'zh-CN'}>
        {children}
      </LiekanLocaleContext.Provider>
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  document.cookie = 'liekan.locale=; Path=/; Max-Age=0';
  useApp.setState({ locale: 'zh-CN' });
  mocks.initiate.mockImplementation((_data, callbacks) =>
    callbacks.onSuccess({ manualKey: 'LOCAL_TEST_KEY' }),
  );
});

it('allows a required two-factor dialog to change language without restarting setup or losing the code', async () => {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <Languages>
        <TwoFactorSetupModal required />
      </Languages>
    </QueryClientProvider>,
  );
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Verification code' }), {
    target: { value: '123' },
  });
  fireEvent.change(within(dialog).getByRole('combobox', { name: 'Language / 语言' }), {
    target: { value: 'en-US' },
  });
  await waitFor(() => expect(dialog).toHaveTextContent('Setup two-factor authentication'));
  expect(within(dialog).getByRole('textbox', { name: 'Verification code' })).toHaveValue('123');
  expect(mocks.initiate).toHaveBeenCalledTimes(1);
  expect(mocks.confirm).not.toHaveBeenCalled();
  expect(mocks.cancel).not.toHaveBeenCalled();
  expect(document.cookie).toContain('liekan.locale=en-US');
  client.clear();
});

it('keeps the saved-code acknowledgement and original recovery codes through a language change', async () => {
  render(
    <Languages>
      <TwoFactorSuccessModal backupCodes={['LOCAL-TEST-CODE']} onClose={vi.fn()} />
    </Languages>,
  );
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('checkbox'));
  fireEvent.change(within(dialog).getByRole('combobox', { name: 'Language / 语言' }), {
    target: { value: 'en-US' },
  });
  await waitFor(() => expect(dialog).toHaveTextContent('Two-factor authentication enabled'));
  expect(within(dialog).getByRole('checkbox')).toBeChecked();
  expect(dialog).toHaveTextContent('LOCAL-TEST-CODE');
  expect(within(dialog).getByRole('button', { name: 'Close' })).toBeEnabled();
});

it.each([
  ['initiate', 'two-factor-error-invalid-code'],
  ['confirm', 'two-factor-error-invalid-code'],
  ['initiate', 'error'],
  ['confirm', 'error'],
])('updates an existing %s %s error in the selected language', async (phase, code) => {
  const issue = code === 'error' ? undefined : Object.assign(new Error(), { code });
  if (phase === 'initiate')
    mocks.initiate.mockImplementation((_data, callbacks) => callbacks.onError(issue));
  else mocks.confirm.mockRejectedValue(issue);
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <Languages>
        <TwoFactorSetupModal required />
      </Languages>
    </QueryClientProvider>,
  );
  const dialog = await screen.findByRole('dialog');
  if (phase === 'confirm') {
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Verification code' }), {
      target: { value: '123456' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: chinese.label.confirm }));
  }
  await waitFor(() => expect(dialog).toHaveTextContent(chinese.message[code]));
  fireEvent.change(within(dialog).getByRole('combobox', { name: 'Language / 语言' }), {
    target: { value: 'en-US' },
  });
  await waitFor(() => expect(dialog).toHaveTextContent(english.message[code]));
  client.clear();
});
