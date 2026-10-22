import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
  refresh: vi.fn(),
  siteId: 'site-a',
}));
vi.mock('./context', () => ({
  useFeature: () => ({
    siteId: mocks.siteId,
    api: { post: mocks.post, get: mocks.get },
    refresh: mocks.refresh,
  }),
}));
vi.mock('./ui', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  Panel: ({ children, title }: any) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  Body: ({ children }: any) => <div>{children}</div>,
  Notice: ({ children }: any) => <p>{children}</p>,
  Table: ({ rows, empty }: any) => (
    <div>
      {rows.length
        ? rows.map((row: any[], i: number) => (
            <div key={i}>
              {row.map((cell, j) => (
                <span key={j}>{cell}</span>
              ))}
            </div>
          ))
        : empty}
    </div>
  ),
}));
import { TrafficGovernance } from './TrafficGovernance';
const audit: any = { governance: { revision: '4', epoch: '2', collections: [] } };
const findings: any = [
  { sessionId: 'session', visitId: 'visit', windowEnd: '2026-10-22T00:05:00Z' },
];
const preview = {
  action: 'preview',
  id: 'preview',
  digest: 'digest',
  revision: '4',
  expiresAt: '2099-01-01T00:00:00Z',
  evidence: { events: 40, pageviews: 40 },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.siteId = 'site-a';
  mocks.post.mockResolvedValue(preview);
  mocks.refresh.mockResolvedValue(undefined);
});
it('previews before an explicit confirmation and sends the frozen digest', async () => {
  const refresh = vi.fn().mockResolvedValue(undefined);
  render(<TrafficGovernance audit={audit} findings={findings} canManage refresh={refresh} />);
  expect(mocks.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '预览排除' }));
  await screen.findByRole('button', { name: '确认排除这些事件' });
  expect(mocks.post.mock.calls[0][1]).toMatchObject({
    action: 'preview',
    expectedRevision: '4',
    visits: [{ sessionId: 'session', visitId: 'visit' }],
  });
  mocks.post.mockResolvedValue({ action: 'confirm', id: 'preview', revision: '5' });
  fireEvent.click(screen.getByRole('button', { name: '确认排除这些事件' }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  expect(mocks.post.mock.calls[1][1]).toEqual({
    action: 'confirm',
    previewId: 'preview',
    digest: 'digest',
    expectedRevision: '4',
  });
});
it('blocks read-only actions and clears a preview when the governing revision changes', async () => {
  const view = render(
    <TrafficGovernance
      audit={audit}
      findings={findings}
      canManage={false}
      refresh={mocks.refresh}
    />,
  );
  expect(screen.getByRole('button', { name: '预览排除' })).toBeDisabled();
  view.rerender(
    <TrafficGovernance audit={audit} findings={findings} canManage refresh={mocks.refresh} />,
  );
  fireEvent.click(screen.getByRole('button', { name: '预览排除' }));
  await screen.findByRole('button', { name: '确认排除这些事件' });
  view.rerender(
    <TrafficGovernance
      audit={{ ...audit, governance: { ...audit.governance, revision: '5' } }}
      findings={findings}
      canManage
      refresh={mocks.refresh}
    />,
  );
  expect(screen.queryByRole('button', { name: '确认排除这些事件' })).toBeNull();
});

it('previews each candidate separately and loads older revocable collections', async () => {
  mocks.get.mockResolvedValue({
    collections: [
      {
        id: 'older-active',
        state: 'active',
        epoch: '2',
        createdAt: '2026-10-22T00:00:00Z',
        evidence: { events: 40 },
      },
    ],
    nextCursor: null,
  });
  render(
    <TrafficGovernance
      audit={{ ...audit, governance: { ...audit.governance, nextCursor: 'cursor' } }}
      findings={[
        ...findings,
        { ...findings[0], sessionId: 'other-session', visitId: 'other-visit' },
      ]}
      canManage
      refresh={mocks.refresh}
    />,
  );
  const buttons = screen.getAllByRole('button', { name: '预览排除' });
  expect(buttons).toHaveLength(2);
  fireEvent.click(buttons[0]);
  await screen.findByRole('button', { name: '确认排除这些事件' });
  expect(mocks.post.mock.calls[0][1].visits).toEqual([{ sessionId: 'session', visitId: 'visit' }]);
  fireEvent.click(screen.getByRole('button', { name: '加载更多排除记录' }));
  await screen.findByRole('button', { name: '撤销排除' });
  fireEvent.click(screen.getByRole('button', { name: '撤销排除' }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenLastCalledWith(expect.any(String), {
      action: 'revoke',
      collectionId: 'older-active',
      expectedRevision: '4',
    }),
  );
});
