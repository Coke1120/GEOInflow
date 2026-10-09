import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CrawlerPoliciesPanel } from './CrawlerPoliciesPanel';
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  list: null as any,
  detail: null as any,
  preview: null as any,
}));
vi.mock('@/lib/liekan/upstream/features-client', () => ({ featureRequest: mocks.request }));
const policy = {
  id: '12345678-1234-4234-8234-123456789012',
  websiteId: '12345678-1234-4234-8234-123456789013',
  name: '测试策略',
  botIds: ['gptbot'],
  paths: [{ value: '/docs', match: 'prefix' }],
  action: 'observe',
  expectedAccess: 'allow',
  version: 1,
  state: 'draft',
  ref: 'liekan_test',
  remoteRuleId: null,
  appliedVersion: null,
  connectionId: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list = {
    policies: [policy],
    connections: [],
    deployments: [],
    permissions: { canDraft: true, canControl: true },
    controlPaused: false,
  };
  mocks.detail = { policy, versions: [] };
  mocks.preview = {
    id: '12345678-1234-4234-8234-123456789014',
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    policyId: policy.id,
    policyVersion: 1,
    operation: 'deploy',
    hostname: 'example.com',
    localOnly: true,
    before: { rule: null },
    after: { body: policy },
    impact: {
      historicalRequests7d: { requests: null, unclassified: 0 },
      searchBots: [],
      fullSite: false,
    },
  };
  mocks.request.mockImplementation(async (method, path) => {
    if (method === 'GET') return path.endsWith(policy.id) ? mocks.detail : mocks.list;
    if (path.endsWith('/preview')) return mocks.preview;
    return policy;
  });
});
it('allows a team member to preview local observe while remote control is paused', async () => {
  mocks.list.permissions.canControl = false;
  mocks.list.controlPaused = true;
  render(
    <CrawlerPoliciesPanel
      websiteId={policy.websiteId}
      permissions={{ canDraft: true, canControl: false }}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: '查看与操作' }));
  expect(await screen.findByRole('button', { name: '预览启用' })).toBeEnabled();
  expect(screen.queryByLabelText('独立 API Token')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '预览启用' }));
  expect(await screen.findByText('缺少日志')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '确认启用' })).toBeDisabled();
});
it('requires the displayed preview acknowledgement and reuses the operation UUID after a transport failure', async () => {
  let attempts = 0;
  mocks.request.mockImplementation(async (method, path) => {
    if (method === 'GET') return path.endsWith(policy.id) ? mocks.detail : mocks.list;
    if (path.endsWith('/preview')) return mocks.preview;
    if (path.endsWith('/deploy')) {
      if (!attempts++) throw new Error('网络中断');
      return { id: 'accepted', state: 'queued' };
    }
  });
  render(
    <CrawlerPoliciesPanel
      websiteId={policy.websiteId}
      permissions={{ canDraft: true, canControl: true }}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: '查看与操作' }));
  fireEvent.click(await screen.findByRole('button', { name: '预览启用' }));
  const confirm = await screen.findByRole('button', { name: '确认启用' });
  expect(confirm).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: /我已核对域名/ }));
  fireEvent.click(confirm);
  expect(await screen.findByText('网络中断')).toBeVisible();
  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  await waitFor(() => expect(screen.getByText(/操作 accepted/)).toBeVisible());
  const calls = mocks.request.mock.calls.filter(
    ([method, path]) => method === 'POST' && path.endsWith('/deploy'),
  );
  expect(calls).toHaveLength(2);
  expect(calls[0][2]).toEqual(calls[1][2]);
  expect(calls[0][2]).toMatchObject({
    previewId: mocks.preview.id,
    operationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
  });
});
it('clears the transient Token after a failed connection and does not persist it', async () => {
  const storage = vi.spyOn(Storage.prototype, 'setItem');
  mocks.request.mockImplementation(async (method, path) => {
    if (method === 'GET') return mocks.list;
    if (path.endsWith('/control-connections')) throw new Error('权限不足');
  });
  render(
    <CrawlerPoliciesPanel
      websiteId={policy.websiteId}
      permissions={{ canDraft: true, canControl: true }}
    />,
  );
  await screen.findByRole('button', { name: '查看与操作' });
  fireEvent.change(screen.getByLabelText(/Cloudflare Zone ID/), {
    target: { value: 'a'.repeat(32) },
  });
  const token = screen.getByLabelText(/独立 API Token/);
  fireEvent.change(token, { target: { value: 'sensitive-test-token' } });
  fireEvent.click(screen.getByRole('button', { name: '读取并连接当前 Zone' }));
  expect(await screen.findByText('权限不足')).toBeVisible();
  expect(token).toHaveValue('');
  expect(storage.mock.calls.some(call => String(call).includes('sensitive-test-token'))).toBe(
    false,
  );
  storage.mockRestore();
});
it('preserves mixed exact/prefix selectors when only the draft name changes', async () => {
  const mixed = {
    ...policy,
    paths: [
      { value: '/docs', match: 'prefix' },
      { value: '/about', match: 'exact' },
    ],
  };
  mocks.list.policies = [mixed];
  mocks.detail = { policy: mixed, versions: [] };
  render(
    <CrawlerPoliciesPanel
      websiteId={policy.websiteId}
      permissions={{ canDraft: true, canControl: true }}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: '查看与操作' }));
  fireEvent.click(await screen.findByRole('button', { name: '编辑草稿' }));
  fireEvent.change(screen.getByLabelText(/策略名称/), { target: { value: '修改名称' } });
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await waitFor(() =>
    expect(mocks.request.mock.calls.some(([method]) => method === 'PATCH')).toBe(true),
  );
  expect(mocks.request.mock.calls.find(([method]) => method === 'PATCH')[2].paths).toEqual(
    mixed.paths,
  );
});
it('uses the dedicated adoption confirmation after displaying the old and new connection', async () => {
  const old = { ...policy, remoteRuleId: 'rule', state: 'enabled' };
  mocks.list.policies = [old];
  mocks.detail = { policy: old, versions: [], contextCurrent: false };
  mocks.preview = {
    ...mocks.preview,
    mode: 'adopt',
    localOnly: false,
    transfer: {
      previous: { connectionId: 'old-connection', generation: 1 },
      next: { connectionId: 'new-connection', generation: 2 },
    },
  };
  mocks.request.mockImplementation(async (method, path) => {
    if (method === 'GET') return path.endsWith(policy.id) ? mocks.detail : mocks.list;
    if (path.endsWith('/preview')) return mocks.preview;
    if (path.endsWith('/adopt')) return { id: 'adoption', mode: 'adopt', state: 'confirmed' };
  });
  render(
    <CrawlerPoliciesPanel
      websiteId={policy.websiteId}
      permissions={{ canDraft: true, canControl: true }}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: '查看与操作' }));
  fireEvent.click(await screen.findByRole('button', { name: '预览接管原规则' }));
  expect(await screen.findByText(/old-connection/)).toBeVisible();
  const confirm = screen.getByRole('button', { name: '确认接管' });
  expect(confirm).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: /我已核对域名/ }));
  fireEvent.click(confirm);
  await waitFor(() =>
    expect(
      mocks.request.mock.calls.some(
        ([method, path]) => method === 'POST' && path.endsWith('/adopt'),
      ),
    ).toBe(true),
  );
  expect(
    mocks.request.mock.calls.some(
      ([method, path]) => method === 'POST' && path.endsWith('/deploy'),
    ),
  ).toBe(false);
});
