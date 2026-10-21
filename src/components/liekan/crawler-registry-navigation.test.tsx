import { render, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ManagementDrawer } from './ManagementDrawer';
const h = vi.hoisted(() => ({ replace: vi.fn(), get: vi.fn() }));
vi.mock('@/lib/liekan/upstream/client', () => ({
  useApi: () => ({ get: h.get }),
  useNavigation: () => ({ router: { replace: h.replace } }),
}));
it.each(['特征库管理', '解析规则'])(
  'routes the old %s action to the one global manager without loading a second editor',
  async action => {
    h.replace.mockClear();
    h.get.mockClear();
    const websiteId = '11111111-1111-4111-8111-111111111111';
    const view = render(
      <ManagementDrawer
        action={action}
        websiteId={websiteId}
        canManage
        onClose={() => {}}
        onSaved={() => {}}
        onSearch={() => {}}
        onRange={() => {}}
      />,
    );
    await waitFor(() =>
      expect(h.replace).toHaveBeenCalledWith(`/crawlers/manage?site=${websiteId}`),
    );
    expect(h.get).not.toHaveBeenCalled();
    expect(view.container).toBeEmptyDOMElement();
  },
);
