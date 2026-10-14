import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { LiekanLocaleContext } from '@/lib/liekan/i18n/client';
import { initializeLocale, useLocale } from '@/components/hooks/useLocale';
import { useApp } from '@/store/app';
import { LOCALE_CONFIG } from '@/lib/constants';
import {
  clearFeatureLogin,
  getFeaturePreferences,
  saveFeaturePreferences,
} from '@/lib/liekan/upstream/features-client';
import { LanguageSelector } from './LanguageSelector';
import { FilterChip, MetricCard, SortHeading } from './ReportComponents';
import { ReportContext } from './ReportContext';
import { Definition, Field, Form, Panel, Select, Table, Tabs, Metrics } from './features/ui';
import { FeatureProvider } from './features/context';
import { BotRulesEditor } from './features/BotRulesEditor';

it('preserves an unknown bot-rule draft label and value through a language change', () => {
  const content = JSON.stringify([
    { name: 'Custom', vendor: 'Original vendor', type: '网站管理', pattern: 'CustomBot' },
  ]);
  const onChange = vi.fn();
  render(
    <LiveLanguage>
      <BotRulesEditor content={content} onChange={onChange} disabled={false} />
    </LiveLanguage>,
  );
  const select = screen.getByRole('combobox');
  expect(select).toHaveValue('网站管理');
  act(() => useApp.setState({ locale: 'en-US' }));
  expect(select).toHaveValue('网站管理');
  expect(select.querySelector('option:checked')).toHaveTextContent('网站管理');
  expect(onChange).not.toHaveBeenCalled();
});

beforeEach(() => {
  localStorage.clear();
  document.cookie = 'liekan.locale=; Path=/; Max-Age=0';
  history.replaceState({}, '', '/');
  useApp.setState({ locale: 'zh-CN' });
});
function LiveLanguage({ children }: { children: React.ReactNode }) {
  const { locale } = useLocale();
  return (
    <LiekanLocaleContext.Provider value={locale === 'en-US' ? locale : 'zh-CN'}>
      {children}
    </LiekanLocaleContext.Provider>
  );
}
it('migrates a legacy preference and keeps it after logout, reinitialization and URL hints', async () => {
  localStorage.setItem(LOCALE_CONFIG, JSON.stringify('en-US'));
  history.replaceState({}, '', '/?locale=zh-CN');
  initializeLocale('zh-CN');
  expect(useApp.getState().locale).toBe('en-US');
  expect(document.cookie).toContain('liekan.locale=en-US');
  clearFeatureLogin();
  initializeLocale('zh-CN');
  expect(useApp.getState().locale).toBe('en-US');
  const { result } = renderHook(() => useLocale());
  await act(async () => {
    await result.current.saveLocale('zh-CN');
  });
  initializeLocale('en-US');
  expect(useApp.getState().locale).toBe('zh-CN');
});
it('changes language immediately and saves other preferences without overwriting the selection', async () => {
  render(
    <LiveLanguage>
      <LanguageSelector field />
      <Form
        onSubmit={() => saveFeaturePreferences({ range: '7day', timezone: 'UTC', theme: 'light' })}
      >
        <Field label="Name" name="name" defaultValue="draft" />
      </Form>
    </LiveLanguage>,
  );
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'unsaved draft' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Language / 语言' }), {
    target: { value: 'en-US' },
  });
  await waitFor(() => expect(useApp.getState().locale).toBe('en-US'));
  expect(screen.getByRole('textbox')).toHaveValue('unsaved draft');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
  expect(useApp.getState().locale).toBe('en-US');
  expect(document.cookie).toContain('liekan.locale=en-US');
});
it('uses the current-page selection and explains when both storage mechanisms are blocked', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Blocked', 'SecurityError');
  });
  vi.spyOn(document, 'cookie', 'set').mockImplementation(() => {});
  render(
    <LiveLanguage>
      <LanguageSelector />
    </LiveLanguage>,
  );
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'en-US' } });
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('Language changed for this page'),
  );
  expect(useApp.getState().locale).toBe('en-US');
  vi.restoreAllMocks();
});
it.each(['ignored', 'throwing'])(
  'reports a failed save when a stale canonical cookie overrides a writable legacy preference (%s)',
  async behavior => {
    document.cookie = 'liekan.locale=zh-CN; Path=/';
    const cookie = vi.spyOn(document, 'cookie', 'set').mockImplementation(() => {
      if (behavior === 'throwing') throw new DOMException('Blocked', 'SecurityError');
    });
    try {
      render(
        <LiveLanguage>
          <LanguageSelector />
        </LiveLanguage>,
      );
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'en-US' } });
      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent('Language changed for this page'),
      );
      expect(useApp.getState().locale).toBe('en-US');
      expect(JSON.parse(localStorage.getItem(LOCALE_CONFIG)!)).toBe('en-US');
      act(() => initializeLocale('en-US'));
      expect(useApp.getState().locale).toBe('zh-CN');
    } finally {
      cookie.mockRestore();
    }
  },
);
it('persists through legacy storage when cookies are blocked and no valid cookie contradicts the choice', async () => {
  const cookie = vi.spyOn(document, 'cookie', 'set').mockImplementation(() => {});
  try {
    const { result } = renderHook(() => useLocale());
    await act(async () =>
      expect(await result.current.saveLocale('en-US')).toEqual({ persisted: true }),
    );
    act(() => initializeLocale('zh-CN'));
    expect(useApp.getState().locale).toBe('en-US');
  } finally {
    cookie.mockRestore();
  }
});
it('keeps initialization usable when browser policy blocks reading cookies', async () => {
  localStorage.setItem(LOCALE_CONFIG, JSON.stringify('en-US'));
  const cookie = vi.spyOn(document, 'cookie', 'get').mockImplementation(() => {
    throw new DOMException('Blocked', 'SecurityError');
  });
  try {
    expect(() => initializeLocale('zh-CN')).not.toThrow();
    expect(useApp.getState().locale).toBe('en-US');
    expect(getFeaturePreferences().language).toBe('en-US');
    const { result } = renderHook(() => useLocale());
    await act(async () =>
      expect(await result.current.saveLocale('en-US')).toEqual({ persisted: false }),
    );
  } finally {
    cookie.mockRestore();
  }
});
it('translates display labels while retaining card lookup, filter and sort identifiers', () => {
  const onFilter = vi.fn(),
    onSort = vi.fn();
  const actions = {
    filter: '全部',
    period: '30 天',
    query: '',
    sort: { label: '会话', direction: -1 },
    onFilter,
    onSort,
    onAction: vi.fn(),
  };
  render(
    <LiekanLocaleContext.Provider value="en-US">
      <ReportContext.Provider value={actions}>
        <MetricCard
          label="搜索总会话"
          className="metric"
          valueClass="value"
          report={{ cards: [{ label: '搜索总会话', value: 23, state: 'available' }] } as any}
        />
        <FilterChip label="全部" />
        <table>
          <thead>
            <tr>
              <SortHeading label="会话" className="header" />
            </tr>
          </thead>
        </table>
      </ReportContext.Provider>
    </LiekanLocaleContext.Provider>,
  );
  expect(screen.getByText('23')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'All' }));
  expect(onFilter).toHaveBeenCalledWith('全部');
  fireEvent.click(screen.getByRole('button', { name: /Sessions/ }));
  expect(onSort).toHaveBeenCalledWith('会话');
});
it('retains user content matching Chinese product copy and static option values', () => {
  const updateQuery = vi.fn();
  render(
    <LiekanLocaleContext.Provider value="en-US">
      <FeatureProvider value={{ query: {}, updateQuery } as any}>
        <Panel title="页面访问" subtitle="网站管理">
          <Definition items={[['网站名称', '网站管理']]} />
          <Select label="Names" options={[['id', '网站管理']]} />
          <Select label="Role" localizeLabels options={[['user', '普通用户']]} />
          <Table columns={['会话']} rows={[[17]]} />
        </Panel>
      </FeatureProvider>
    </LiekanLocaleContext.Provider>,
  );
  expect(screen.getByRole('heading', { name: '页面访问' })).toBeVisible();
  expect(screen.getByRole('option', { name: '网站管理' })).toHaveValue('id');
  expect(screen.getByRole('option', { name: 'Regular user' })).toHaveValue('user');
  fireEvent.click(screen.getByRole('button', { name: /Sessions/ }));
  expect(updateQuery).toHaveBeenCalledWith({ sort: '会话', direction: 'asc' });
});

it('keeps raw property keys, values, descriptions and custom metric names unchanged', () => {
  render(
    <LiekanLocaleContext.Provider value="en-US">
      <Definition items={[['网站名称', '未提供']]} />
      <Tabs items={[['key', '网站名称']]} active="key" onChange={() => {}} />
      <Metrics items={[['网站名称', '未提供', '网站名称']]} />
    </LiekanLocaleContext.Provider>,
  );
  expect(screen.getByRole('term')).toHaveTextContent('网站名称');
  expect(screen.getByRole('definition')).toHaveTextContent('未提供');
  expect(screen.getByRole('tab', { name: '网站名称' })).toBeVisible();
  expect(screen.getAllByText('未提供')).toHaveLength(2);
  expect(screen.queryByText('Website name')).not.toBeInTheDocument();
});
