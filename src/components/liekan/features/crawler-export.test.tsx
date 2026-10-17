import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { crawlerDirectory } from '@/lib/liekan/crawlers/directory';
import { exportNginxPolicy } from '@/lib/liekan/crawlers/templates';
const mocks = vi.hoisted(() => ({ request: vi.fn(), download: vi.fn() }));
vi.mock('@/lib/liekan/upstream/features-client', () => ({ featureRequest: mocks.request }));
vi.mock('../data', async original => ({
  ...(await original<any>()),
  downloadFile: mocks.download,
}));
import { CrawlerDialog } from './CrawlerDialog';
vi.mock('./TrafficEvidencePanel', () => ({
  TrafficEvidencePanel: ({ botId, mode = 'evidence' }: any) => (
    <output data-test="evidence-selection">{JSON.stringify({ botId: botId || null, mode })}</output>
  ),
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});
it.each([
  [undefined, undefined, null],
  ['GPTBot', 'gptbot', 'gptbot'],
  ['GPTBot', null, 'custom:GPTBot'],
] as const)(
  'keeps evidence selection explicit for entry %s / %s',
  async (botName, selectedIdentity, expected) => {
    const data = {
      quality: { state: 'unknown' },
      directory: crawlerDirectory,
      bots: [
        { botId: null, name: 'GPTBot', requests: 7 },
        { botId: 'gptbot', name: 'GPTBot', requests: 999 },
      ],
      pages: [],
      platforms: [],
      previous: { bots: [], platforms: [] },
      findings: [],
      criticalPaths: [],
      analysis: null,
      range: { startAt: 1792022400000, endAt: 1792108800000, timezone: 'UTC' },
      permissions: { canDraft: false, canControl: false },
    };
    mocks.request.mockResolvedValue(data);
    render(
      <CrawlerDialog
        websiteId="12345678-1234-4234-8234-123456789012"
        botName={botName}
        selectedIdentity={selectedIdentity}
        onClose={() => {}}
        controlPanel={() => null}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '重新读取归因与风险' })).toBeEnabled(),
    );
    for (const [label, mode] of [
      ['身份与响应', 'evidence'],
      ['资源与性能', 'performance'],
      ['业务效果', 'outcomes'],
    ]) {
      fireEvent.click(screen.getByRole('tab', { name: label }));
      expect(JSON.parse(screen.getByTestId('evidence-selection').textContent)).toEqual({
        botId: expected,
        mode,
      });
      expect(screen.getByLabelText('蜘蛛')).toHaveValue(expected || '');
    }
    fireEvent.change(screen.getByLabelText('蜘蛛'), { target: { value: crawlerDirectory[1].id } });
    fireEvent.click(screen.getByRole('tab', { name: '身份与响应' }));
    expect(JSON.parse(screen.getByTestId('evidence-selection').textContent).botId).toBe(
      crawlerDirectory[1].id,
    );
    fireEvent.change(screen.getByLabelText('蜘蛛'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('tab', { name: '资源与性能' }));
    expect(JSON.parse(screen.getByTestId('evidence-selection').textContent).botId).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: '身份与响应' }));
    fireEvent.change(screen.getByLabelText('蜘蛛'), { target: { value: 'custom:GPTBot' } });
    mocks.request.mockResolvedValue({ ...data, bots: [] });
    fireEvent.change(screen.getByLabelText('蜘蛛身份范围'), {
      target: { value: 'verified_range' },
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '重新读取归因与风险' })).toBeEnabled(),
    );
    expect(screen.getByLabelText('蜘蛛')).toHaveValue('custom:GPTBot');
    expect(JSON.parse(screen.getByTestId('evidence-selection').textContent).botId).toBe(
      'custom:GPTBot',
    );
  },
);
it.each(['FixtureBot', 'GPTBot'])(
  'opens unmapped %s with its own metrics and no default official identity',
  async name => {
    mocks.request.mockResolvedValue({
      quality: { state: 'unknown' },
      directory: crawlerDirectory,
      bots: [
        { botId: null, name, requests: 7 },
        { botId: 'gptbot', name: 'GPTBot', requests: 999 },
      ],
      pages: [],
      platforms: [],
      previous: { bots: [{ botId: null, name, requests: 3 }], platforms: [] },
      findings: [],
      criticalPaths: [],
      analysis: null,
      range: { timezone: 'UTC' },
      permissions: { canDraft: false, canControl: false },
    });
    render(
      <CrawlerDialog
        websiteId="12345678-1234-4234-8234-123456789012"
        botName={name}
        onClose={() => {}}
        controlPanel={() => null}
      />,
    );
    expect(await screen.findByText('7 / 3')).toBeVisible();
    expect(screen.getByLabelText('蜘蛛')).toHaveValue(`custom:${name}`);
    expect(screen.queryByText('999 / 0')).not.toBeInTheDocument();
    expect(screen.queryByText('查看供应商说明')).not.toBeInTheDocument();
  },
);
it.each([401, 403, 404])(
  'clears analysis and draft controls after reload status %s',
  async status => {
    const data = {
      quality: { state: 'missing' },
      directory: crawlerDirectory,
      bots: [],
      pages: [],
      platforms: [],
      previous: { bots: [], platforms: [] },
      findings: [],
      criticalPaths: ['/'],
      analysis: null,
      range: { timezone: 'UTC' },
      permissions: { canDraft: true, canControl: false },
    };
    mocks.request
      .mockResolvedValueOnce(data)
      .mockRejectedValueOnce(Object.assign(new Error('权限已变更'), { status }));
    render(
      <CrawlerDialog
        websiteId="12345678-1234-4234-8234-123456789012"
        onClose={() => {}}
        controlPanel={() => null}
      />,
    );
    expect(await screen.findByRole('button', { name: '保存关键路径' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '重新读取归因与风险' }));
    expect(await screen.findByText('权限已变更')).toBeVisible();
    expect(screen.queryByRole('button', { name: '保存关键路径' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/公开且期望搜索可访问的关键路径/)).not.toBeInTheDocument();
  },
);
it('keeps a healthy analysis idle and reloads explicitly while protecting unsaved paths', async () => {
  vi.useFakeTimers();
  const data = {
    quality: { state: 'missing' },
    directory: crawlerDirectory,
    bots: [],
    pages: [],
    platforms: [],
    previous: { bots: [], platforms: [] },
    findings: [],
    criticalPaths: ['/'],
    analysis: null,
    range: { timezone: 'UTC' },
    permissions: { canDraft: true, canControl: false },
  };
  mocks.request.mockResolvedValue(data);
  render(
    <CrawlerDialog
      websiteId="12345678-1234-4234-8234-123456789012"
      onClose={() => {}}
      controlPanel={() => null}
    />,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
  expect(mocks.request).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600000);
  });
  window.dispatchEvent(new Event('focus'));
  window.dispatchEvent(new Event('online'));
  document.dispatchEvent(new Event('visibilitychange'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
  expect(mocks.request).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '重新读取归因与风险' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
  expect(mocks.request).toHaveBeenCalledTimes(2);
  const input = screen.getByLabelText(/公开且期望搜索可访问的关键路径/);
  fireEvent.change(input, { target: { value: '/draft' } });
  fireEvent.click(screen.getByRole('button', { name: '重新读取归因与风险' }));
  expect(screen.getByText('请先保存关键路径输入，再重新读取。')).toBeVisible();
  expect(input).toHaveValue('/draft');
  expect(mocks.request).toHaveBeenCalledTimes(2);
});
it('displays and downloads the dry-run limiter selected in the export form', async () => {
  const data = {
    quality: { state: 'missing' },
    directory: crawlerDirectory,
    bots: [],
    pages: [],
    platforms: [],
    previous: { bots: [], platforms: [] },
    findings: [],
    criticalPaths: [],
    analysis: null,
    range: { timezone: 'UTC' },
    permissions: { canDraft: false, canControl: false },
  };
  mocks.request.mockImplementation(async (method, path, body) => {
    if (path.endsWith('/crawler-analysis')) return data;
    if (path.endsWith('/crawler-policies'))
      return {
        policies: [],
        connections: [],
        deployments: [],
        permissions: data.permissions,
        controlPaused: true,
      };
    if (path.endsWith('/crawler-exports'))
      return {
        ...exportNginxPolicy('example.com', body.policy, { rateLimit: body.rateLimit }),
        kind: 'nginx',
      };
  });
  render(<CrawlerDialog websiteId="12345678-1234-4234-8234-123456789012" onClose={() => {}} />);
  await screen.findByText('保存关键路径');
  fireEvent.click(screen.getByText('访问策略与导出'));
  fireEvent.click(screen.getByText('导出 robots.txt 与 Nginx 配置'));
  fireEvent.change(screen.getByLabelText('导出动作'), { target: { value: 'rate' } });
  fireEvent.click(screen.getByRole('button', { name: '生成 Nginx 配置片段' }));
  await waitFor(() => expect(screen.getByText(/limit_req_dry_run on;/)).toBeVisible());
  fireEvent.click(screen.getByRole('button', { name: '下载当前草稿' }));
  const text = mocks.download.mock.calls[0][0];
  expect(text).toContain('limit_req_zone');
  expect(text).toContain('rate=10r/s');
  expect(text).toContain('burst=20');
  expect(text).not.toContain('return 403');
  const call = mocks.request.mock.calls.find(([, path]) => path.endsWith('/crawler-exports'));
  expect(call[2].policy.action).toBe('observe');
  expect(call[2].rateLimit.dryRun).toBe(true);
});
it.each(['gptbot', null])(
  'respects explicit identity %s for same-name official and custom rows',
  async selectedIdentity => {
    mocks.request.mockResolvedValue({
      quality: { state: 'unknown' },
      directory: crawlerDirectory,
      bots: [
        { botId: null, name: 'GPTBot', requests: 7 },
        { botId: 'gptbot', name: 'GPTBot', requests: 999 },
      ],
      pages: [],
      platforms: [],
      previous: { bots: [], platforms: [] },
      findings: [],
      criticalPaths: [],
      analysis: null,
      range: { timezone: 'UTC' },
      permissions: { canDraft: false, canControl: false },
    });
    render(
      <CrawlerDialog
        websiteId="12345678-1234-4234-8234-123456789012"
        botName="GPTBot"
        selectedIdentity={selectedIdentity}
        onClose={() => {}}
        controlPanel={() => null}
      />,
    );
    expect(await screen.findByText(selectedIdentity ? '999 / 0' : '7 / 0')).toBeVisible();
    expect(screen.getByLabelText('蜘蛛')).toHaveValue(selectedIdentity ?? 'custom:GPTBot');
  },
);
