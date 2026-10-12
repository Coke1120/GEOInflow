import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { FeatureProvider } from './context';
import { TeamUserCreateDialog } from './TeamUserCreateDialog';
vi.mock('next/link', () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));
const teamId = '33333333-3333-4333-8333-333333333333';
const team = { id: teamId, name: '验收团队' };
const post = vi.fn(),
  get = vi.fn(),
  created = vi.fn(),
  close = vi.fn();
const context = (userId = 'admin') => ({
  user: { id: userId, role: 'admin', isAdmin: true },
  route: { page: 'team-detail' },
  api: { post, get },
  href: () => '/admin/users',
  sites: [],
  notify: vi.fn(),
});
const result = (body: any) => ({
  state: 'created',
  user: { id: body.userId, username: body.username, role: 'user' },
  member: {
    id: body.userId,
    userId: body.userId,
    teamId,
    role: body.teamRole,
    createdAt: new Date(0).toISOString(),
  },
  page: 2,
});
function mount() {
  const view = (id = 'admin') => (
    <FeatureProvider value={context(id) as any}>
      <TeamUserCreateDialog team={team} onClose={close} onCreated={created} />
    </FeatureProvider>
  );
  return { ...render(view()), view };
}
async function fill(password = 'test-pass-1', confirmation = password) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/^用户名/), ' Example ');
  await user.type(screen.getByLabelText(/^初始密码/), password);
  await user.type(screen.getByLabelText(/^确认密码/), confirmation);
  return user;
}
beforeEach(() => {
  vi.clearAllMocks();
  post.mockImplementation(async (_path, body) => result(body));
});
it('defaults to read only and submits only regular-account fields with an exact page result', async () => {
  mount();
  expect(screen.getByLabelText('团队角色')).toHaveValue('team-view-only');
  const user = await fill();
  await user.click(screen.getByRole('button', { name: '创建并加入团队' }));
  await waitFor(() => expect(created).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })));
  expect(post.mock.calls[0][1]).toEqual({
    userId: expect.any(String),
    username: 'example',
    password: 'test-pass-1',
    teamRole: 'team-view-only',
  });
  expect(screen.getByLabelText('系统角色')).toHaveValue('普通用户');
});
it('rejects mismatched and oversized multibyte passwords before sending', async () => {
  mount();
  const user = await fill('中'.repeat(25));
  await user.click(screen.getByRole('button', { name: '创建并加入团队' }));
  expect(await screen.findByText(/密码按 UTF-8 编码最多 72 字节/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/^确认密码/), { target: { value: 'other-pass' } });
  await user.click(screen.getByRole('button', { name: '创建并加入团队' }));
  expect(await screen.findByText('两次输入的密码不一致')).toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});
it('recovers a lost response through a read without another write', async () => {
  mount();
  post.mockRejectedValue(new Error('connection lost'));
  get.mockImplementation(async (_path, params) =>
    result({ ...params, username: 'example', teamRole: 'team-view-only' }),
  );
  const user = await fill();
  await user.click(screen.getByRole('button', { name: '创建并加入团队' }));
  await waitFor(() => expect(created).toHaveBeenCalledTimes(1));
  expect(post).toHaveBeenCalledTimes(1);
  expect(get).toHaveBeenCalledWith(
    `/liekan/teams/${teamId}/users/create`,
    {
      userId: post.mock.calls[0][1].userId,
    },
    expect.any(AbortSignal),
  );
});
it('keeps absent or hard-deleted results read only and never replays the original creation', async () => {
  mount();
  post
    .mockRejectedValueOnce(new Error('connection lost'))
    .mockImplementation(async (_path, body) => result(body));
  get.mockResolvedValue({ state: 'unconfirmed' });
  const user = await fill();
  await user.click(screen.getByRole('button', { name: '创建并加入团队' }));
  await user.click(await screen.findByRole('button', { name: '核对创建结果' }));
  expect(screen.queryByRole('button', { name: '重试本次创建' })).not.toBeInTheDocument();
  expect(post).toHaveBeenCalledTimes(1);
  expect(created).not.toHaveBeenCalled();
});
it('prevents replay when an existing account has changed membership', async () => {
  mount();
  post.mockRejectedValue(new Error('connection lost'));
  get.mockResolvedValue({
    state: 'changed',
    user: { id: teamId, username: 'example', role: 'user' },
  });
  const user = await fill();
  await user.click(screen.getByRole('button', { name: '创建并加入团队' }));
  await screen.findByText(/当前角色或团队归属已有变化/);
  expect(screen.queryByRole('button', { name: '重试本次创建' })).not.toBeInTheDocument();
  expect(created).not.toHaveBeenCalled();
});
it('discards a late response after the login identity changes', async () => {
  const mounted = mount();
  let resolve: (value: any) => void;
  post.mockImplementation(
    () =>
      new Promise(done => {
        resolve = done;
      }),
  );
  const user = await fill();
  await user.click(screen.getByRole('button', { name: '创建并加入团队' }));
  mounted.rerender(mounted.view('other-admin'));
  await act(async () => resolve(result(post.mock.calls[0][1])));
  expect(created).not.toHaveBeenCalled();
});
it('keeps a definite duplicate username editable for correction', async () => {
  mount();
  post.mockRejectedValue(
    Object.assign(new Error('用户名已存在'), { status: 409, code: 'username-conflict' }),
  );
  const user = await fill();
  await user.click(screen.getByRole('button', { name: '创建并加入团队' }));
  await waitFor(() => expect(screen.getByLabelText(/^用户名/)).toHaveValue(' Example '));
  expect(await screen.findByText('用户名已存在')).toBeInTheDocument();
  expect(get).not.toHaveBeenCalled();
});
it('bounds a hanging creation request and enables outcome reconciliation', async () => {
  mount();
  await fill();
  post.mockImplementation(() => new Promise(() => {}));
  get.mockResolvedValue({ state: 'unconfirmed' });
  vi.useFakeTimers();
  try {
    fireEvent.click(screen.getByRole('button', { name: '创建并加入团队' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(screen.getByRole('button', { name: '核对创建结果' })).toBeEnabled();
    expect(created).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
it('retains the unresolved result after permission revocation without another write', async () => {
  mount();
  post
    .mockRejectedValueOnce(new Error('connection lost'))
    .mockRejectedValue(Object.assign(new Error('系统管理权限已变更'), { status: 403 }));
  get.mockResolvedValue({ state: 'unconfirmed' });
  const user = await fill();
  await user.click(screen.getByRole('button', { name: '创建并加入团队' }));
  get.mockRejectedValue(Object.assign(new Error('系统管理权限已变更'), { status: 403 }));
  await user.click(await screen.findByRole('button', { name: '核对创建结果' }));
  expect(await screen.findByText('结果核对失败，请重新读取。')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '核对创建结果' })).toBeEnabled();
  expect(post).toHaveBeenCalledTimes(1);
  expect(created).not.toHaveBeenCalled();
});
