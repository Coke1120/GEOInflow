import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AutomaticLogSetup } from './AutomaticLogSetup';
const mocks = vi.hoisted(() => ({
  api: { post: vi.fn(), put: vi.fn(), del: vi.fn() },
  notify: vi.fn(),
  query: {} as any,
}));
vi.mock('./context', () => ({ useFeature: () => mocks }));
const site = '5b4c0de0-6c47-5b51-8f53-11e5e8c79001';
const refresh = vi.fn().mockResolvedValue({});
const status: any = { capabilities: { server: true, cloudflare: true }, sources: [] };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.query = {};
});
function mount(method: 'server' | 'cloudflare', data = status) {
  return render(
    <StrictMode>
      <AutomaticLogSetup websiteId={site} method={method} status={data} manage refresh={refresh} />
    </StrictMode>,
  );
}
it('generates the installation command in Strict Mode and disables an unavailable receiver', async () => {
  mocks.api.post.mockResolvedValue({
    command: 'signed-install-command',
    expiresAt: '2026-10-04T12:00:00Z',
  });
  const view = mount('server');
  fireEvent.click(screen.getByRole('button', { name: '生成一次安装命令' }));
  expect(await screen.findByText('signed-install-command')).toBeVisible();
  expect(mocks.api.post).toHaveBeenCalledWith(
    `/liekan/websites/${site}/log-sources/server/pairing`,
    {},
  );
  view.unmount();
  mount('server', {
    ...status,
    capabilities: { server: false },
    availability: { server: { reason: '请配置公网 HTTPS 地址' } },
  });
  expect(screen.getByText('请配置公网 HTTPS 地址')).toBeVisible();
  expect(screen.getByRole('button', { name: '生成一次安装命令' })).toBeDisabled();
});
it('requires domain and fee confirmation before completing Cloudflare authorization', async () => {
  mocks.query = { flow: 'a-flow' };
  mocks.api.post.mockResolvedValue({
    domain: 'example.com',
    zones: [{ id: 'zone-a', name: 'example.com' }],
  });
  mount('cloudflare');
  const button = await screen.findByRole('button', { name: '确认并连接' });
  expect(button).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  await waitFor(() => expect(button).not.toBeDisabled());
  mocks.api.post.mockResolvedValue({ sourceId: 'source-a' });
  fireEvent.click(button);
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(mocks.api.post).toHaveBeenLastCalledWith(
    `/liekan/websites/${site}/log-sources/cloudflare/finalize`,
    { flowId: 'a-flow', zoneId: 'zone-a', acceptCosts: true },
  );
});
it('shows deferred source confirmation and batch failures and allows a confirmed source switch', async () => {
  const source = {
    id: 'source-a',
    kind: 'server',
    domain: 'example.com',
    state: 'paused',
    primary: false,
    backlog: 3,
    failed: 2,
    errorCode: 'confirmation-required',
    health: {},
  };
  mocks.api.put.mockResolvedValue({ saved: true });
  mount('server', { ...status, sources: [source] });
  expect(screen.getByText(/有 2 批日志处理失败/)).toBeVisible();
  expect(screen.getByText(/主要来源已变更/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '设为主要来源' }));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(mocks.api.put).toHaveBeenCalledWith(`/liekan/websites/${site}/log-sources/source-a`, {
    action: 'select',
  });
});
it('ignores an obsolete authorization response after leaving the setup page', async () => {
  mocks.query = { flow: 'a-flow' };
  let finish!: (value: any) => void;
  mocks.api.post.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const view = mount('cloudflare');
  view.unmount();
  await act(async () => finish({ sourceId: 'obsolete' }));
  expect(refresh).not.toHaveBeenCalled();
  expect(mocks.notify).not.toHaveBeenCalled();
});
