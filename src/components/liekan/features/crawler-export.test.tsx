import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { crawlerDirectory } from '@/lib/liekan/crawlers/directory';
import { exportNginxPolicy } from '@/lib/liekan/crawlers/templates';
const mocks = vi.hoisted(() => ({ request: vi.fn(), download: vi.fn() }));
vi.mock('@/lib/liekan/upstream/features-client', () => ({ featureRequest: mocks.request }));
vi.mock('../data', async original => ({
  ...(await original<any>()),
  downloadFile: mocks.download,
}));
import { CrawlerDialog } from './CrawlerDialog';
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
