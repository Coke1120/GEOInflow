import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HelpCenter } from './HelpCenter';
import { LiekanLocaleContext } from '@/lib/liekan/i18n/client';

const mocks = vi.hoisted(() => ({
  query: {} as Record<string, string>,
  clipboard: vi.fn(),
  admin: false,
  recognition: undefined as any,
  health: undefined as any,
  calls: [] as any[],
}));
vi.mock('./context', () => ({
  useFeature: () => ({
    query: mocks.query,
    user: { id: 'reader', isAdmin: mocks.admin },
    sites: [{ id: 'site-a', name: 'Website A' }],
  }),
  useData: (key: string[], _load: unknown, enabled: boolean) => {
    mocks.calls.push({ key, enabled });
    return {
      data: enabled
        ? key[0] === 'help-crawler-recognition'
          ? mocks.recognition
          : mocks.health
        : undefined,
      error: null,
    };
  },
}));
vi.mock('next/link', () => ({
  default: ({ children, prefetch: _prefetch, ...props }: any) => <a {...props}>{children}</a>,
}));
describe('help center reading and drafts', () => {
  it('retains English search results and query when the display language changes', () => {
    const view = render(
      <LiekanLocaleContext.Provider value="en-US">
        <HelpCenter />
      </LiekanLocaleContext.Provider>,
    );
    const search = screen.getByRole('searchbox');
    fireEvent.change(search, { target: { value: 'security' } });
    const links = () =>
      [...view.container.querySelectorAll('a[href*="article="]')].map(link =>
        link.getAttribute('href'),
      );
    const before = links();
    expect(before.length).toBeGreaterThan(0);
    view.rerender(
      <LiekanLocaleContext.Provider value="zh-CN">
        <HelpCenter />
      </LiekanLocaleContext.Provider>,
    );
    expect(search).toHaveValue('security');
    expect(links()).toEqual(before);
  });
  beforeEach(() => {
    mocks.query = {};
    mocks.admin = false;
    mocks.recognition = undefined;
    mocks.health = undefined;
    mocks.calls = [];
    mocks.clipboard.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mocks.clipboard },
    });
  });
  it('shows actual enabled IDs only after website selection and restricts runtime health to administrators', () => {
    mocks.query = { crawler: 'gptbot' };
    mocks.recognition = { enabledIds: ['gptbot'], classificationVersion: 'fixture-version' };
    const view = render(<HelpCenter />);
    expect(screen.getByText('当前网站启用：未选择网站')).toBeVisible();
    expect(screen.getByText('当前范围健康：仅系统管理员可查看')).toBeVisible();
    expect(
      mocks.calls
        .filter(call => call.key[0] === 'help-crawler-sources')
        .every(call => !call.enabled),
    ).toBe(true);
    fireEvent.change(screen.getByRole('combobox', { name: '查看网站启用状态' }), {
      target: { value: 'site-a' },
    });
    expect(screen.getByText('当前网站启用：已启用')).toBeVisible();
    mocks.recognition = { enabledIds: [], classificationVersion: 'disabled-version' };
    view.rerender(<HelpCenter />);
    expect(screen.getByText('当前网站启用：未启用')).toBeVisible();
    mocks.admin = true;
    mocks.health = { ipSources: [{ crawlerIds: ['gptbot'], status: 'warning' }] };
    view.rerender(<HelpCenter />);
    expect(screen.getByText('当前范围健康：更新异常')).toBeVisible();
  });
  it('opens without a website and exposes the five categories with global links', () => {
    render(<HelpCenter />);
    const categories = screen.getByRole('navigation', { name: '帮助分类' });
    expect(within(categories).getAllByRole('link')).toHaveLength(6);
    expect(screen.getByRole('heading', { name: '使用指南与参考资料' })).toBeInTheDocument();
    for (const link of within(categories).getAllByRole('link'))
      expect(link.getAttribute('href')).not.toContain('websiteId');
  });
  it('searches articles and UA, and recovers from empty results', () => {
    render(<HelpCenter />);
    const search = screen.getByRole('searchbox', { name: '搜索帮助文档或蜘蛛' });
    fireEvent.change(search, { target: { value: 'openai GPTBot' } });
    const spiders = screen.getByRole('region', { name: '蜘蛛结果' });
    expect(within(spiders).getByRole('link', { name: /GPTBot/ })).toHaveAttribute(
      'href',
      '/liekan/help?crawler=gptbot',
    );
    fireEvent.change(search, { target: { value: 'unfindable-example' } });
    expect(screen.getByRole('heading', { name: '没有匹配的资料' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清空搜索和筛选' }));
    expect(search).toHaveValue('');
  });
  it('exposes the AI collection guides and sends setup through explicit website selection', () => {
    const view = render(<HelpCenter />);
    const guides = screen.getByRole('region', { name: 'AI 蜘蛛采集文档' });
    expect(within(guides).getByRole('link', { name: '查看接入引导' })).toHaveAttribute(
      'href',
      '/liekan/help?article=ai-crawler-start',
    );
    mocks.query = { article: 'ai-crawler-start' };
    view.rerender(<HelpCenter />);
    const setup = screen.getByRole('region', { name: 'AI 蜘蛛接入引导' });
    expect(within(setup).getByRole('link', { name: '选择网站并开始接入' })).toHaveAttribute(
      'href',
      '/websites',
    );
    expect(screen.getByRole('link', { name: 'AI 蜘蛛采集与识别原理' })).toHaveAttribute(
      'href',
      '/liekan/help?article=ai-crawler-principles',
    );
  });
  it('filters control markers and resets filters', () => {
    mocks.query = { section: 'crawlers' };
    render(<HelpCenter />);
    fireEvent.change(screen.getByRole('combobox', { name: '类型' }), {
      target: { value: 'control' },
    });
    const spiders = screen.getByRole('region', { name: '蜘蛛结果' });
    expect(within(spiders).getAllByRole('link')).toHaveLength(3);
    expect(screen.getByRole('status')).toHaveTextContent('3 条结果');
    fireEvent.click(screen.getByRole('button', { name: '重置筛选' }));
    expect(screen.getByRole('combobox', { name: '类型' })).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: /显示更多/ }));
    expect(within(spiders).getAllByRole('link').length).toBe(40);
  });
  it('preserves text entered during a help navigation and clears search when opening the current result', () => {
    mocks.query = { article: 'metric-pv' };
    const view = render(<HelpCenter />);
    fireEvent.click(screen.getByRole('link', { name: '‹ 返回指标词典' }));
    const search = screen.getByRole('searchbox', { name: '搜索帮助文档或蜘蛛' });
    fireEvent.change(search, { target: { value: 'GPTBot' } });
    mocks.query = { section: 'metrics' };
    view.rerender(<HelpCenter />);
    expect(search).toHaveValue('GPTBot');
    expect(screen.getByRole('region', { name: '蜘蛛结果' })).toBeInTheDocument();
    mocks.query = { crawler: 'gptbot' };
    view.rerender(<HelpCenter />);
    fireEvent.change(search, { target: { value: 'GPTBot' } });
    fireEvent.click(
      within(screen.getByRole('region', { name: '蜘蛛结果' })).getByRole('link', {
        name: /GPTBot/,
      }),
    );
    expect(search).toHaveValue('');
    expect(screen.getByRole('heading', { name: 'GPTBot' })).toBeInTheDocument();
  });
  it('renders metrics, related links and a section return from a deep link', () => {
    mocks.query = { article: 'metric-ai-coverage' };
    render(<HelpCenter />);
    expect(screen.getByRole('heading', { name: 'AI 抓取覆盖率', level: 2 })).toBeInTheDocument();
    expect(screen.getByText(/被 AI 请求的目录内不同 URL/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '‹ 返回指标词典' })).toHaveAttribute(
      'href',
      '/liekan/help?section=metrics',
    );
    expect(screen.getByRole('link', { name: '导入内容目录与覆盖率分母' })).toHaveAttribute(
      'href',
      '/liekan/help?article=content-catalog',
    );
  });
  it('renders missing official ranges explicitly and handles clipboard failure without a false success', async () => {
    mocks.query = { crawler: 'mistralai-training' };
    mocks.clipboard.mockRejectedValue(new Error('denied'));
    render(<HelpCenter />);
    expect(screen.getByText('可核验范围：尚未配置')).toBeInTheDocument();
    expect(screen.getByText(/本条尚无随附的可下载官方 IP feed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '复制' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('复制未完成'));
    expect(mocks.clipboard).toHaveBeenCalledWith(
      expect.stringContaining('User-agent: MistralAI-Training'),
    );
    expect(screen.queryByText('已复制配置草稿')).toBeNull();
  });
  it('copies the exact draft and downloads a UTF-8 file with cleanup', async () => {
    mocks.query = { crawler: 'google-extended' };
    const create = vi.fn(() => 'blob:public-draft');
    const revoke = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<HelpCenter />);
    expect(screen.getByText('无独立 UA')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '复制' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已复制配置草稿'));
    expect(mocks.clipboard).toHaveBeenCalledWith(
      expect.stringContaining('User-agent: Google-Extended'),
    );
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole('button', { name: '下载草稿' }));
      expect(create).toHaveBeenCalledOnce();
      expect(click).toHaveBeenCalledOnce();
      expect(document.querySelector('a[download]')).toBeNull();
      vi.advanceTimersByTime(1000);
      expect(revoke).toHaveBeenCalledWith('blob:public-draft');
    } finally {
      vi.useRealTimers();
      click.mockRestore();
    }
  });
  it('preserves pending evidence and renders invalid addresses with a recovery link', () => {
    mocks.query = { crawler: 'petalbot' };
    const view = render(<HelpCenter />);
    expect(screen.getByText('资料待复核')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '复制' })).toBeNull();
    mocks.query = { article: 'removed' };
    view.rerender(<HelpCenter />);
    expect(screen.getByRole('heading', { name: '未找到这份资料' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回帮助中心' })).toHaveAttribute(
      'href',
      '/liekan/help',
    );
  });
});
