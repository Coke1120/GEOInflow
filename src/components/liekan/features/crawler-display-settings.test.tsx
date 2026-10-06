import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CrawlerDisplaySettings } from './CrawlerDisplaySettings';
const mocks = vi.hoisted(() => ({ settings: {} as any, put: vi.fn(), context: {} as any }));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    cancelQueries: vi.fn().mockResolvedValue(undefined),
    setQueryData: vi.fn(),
  }),
}));
vi.mock('./context', () => ({
  useFeature: () => mocks.context,
  useData: () => ({ data: mocks.settings, isPending: false, isFetching: false, refetch: vi.fn() }),
  useAction: () => ({ busy: false, error: '', run: (action: () => Promise<any>) => action() }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings = { aiCrawlerEnabled: true, logsConfigured: false };
  mocks.context = {
    user: { id: 'user-a' },
    siteId: 'site-a',
    api: { put: mocks.put },
    href: () => '/settings',
  };
});
it('saves only the display choice for this website and supports re-enabling', async () => {
  const view = render(<CrawlerDisplaySettings manage />);
  const toggle = screen.getByRole('switch', { name: 'AI 蜘蛛数据展示' });
  expect(toggle).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(toggle);
  await waitFor(() =>
    expect(mocks.put).toHaveBeenCalledWith('/liekan/websites/site-a/settings', {
      aiCrawlerEnabled: false,
    }),
  );
  mocks.settings = { aiCrawlerEnabled: false };
  view.rerender(<CrawlerDisplaySettings manage />);
  expect(toggle).toHaveAttribute('aria-checked', 'false');
  fireEvent.click(toggle);
  await waitFor(() =>
    expect(mocks.put).toHaveBeenCalledWith('/liekan/websites/site-a/settings', {
      aiCrawlerEnabled: true,
    }),
  );
});
it('keeps the display choice readable and prevents changes without management permission', () => {
  render(<CrawlerDisplaySettings manage={false} />);
  expect(screen.getByRole('switch')).toBeDisabled();
  expect(mocks.put).not.toHaveBeenCalled();
});
it('offers optional guidance for an unconnected site, and removes it when connected or hidden', () => {
  const view = render(<CrawlerDisplaySettings manage guide />);
  expect(screen.getByText('暂不接入 AI 蜘蛛日志？')).toBeInTheDocument();
  mocks.settings = { aiCrawlerEnabled: true, logsConfigured: true };
  view.rerender(<CrawlerDisplaySettings manage guide />);
  expect(screen.queryByText('暂不接入 AI 蜘蛛日志？')).not.toBeInTheDocument();
  mocks.settings = { aiCrawlerEnabled: false, logsConfigured: false };
  view.rerender(<CrawlerDisplaySettings manage guide />);
  expect(screen.queryByText('暂不接入 AI 蜘蛛日志？')).not.toBeInTheDocument();
});

it('uses the installation receipt to remove guidance before the settings cache refreshes', () => {
  render(<CrawlerDisplaySettings manage guide logsConnected />);
  expect(screen.queryByText('暂不接入 AI 蜘蛛日志？')).not.toBeInTheDocument();
});
