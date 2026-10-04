import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { WebsiteResetForm } from '@/app/(main)/websites/[websiteId]/settings/WebsiteResetForm';
import { WebsiteDeleteForm } from '@/app/(main)/websites/[websiteId]/settings/WebsiteDeleteForm';
import { WebsiteTransferForm } from '@/app/(main)/websites/[websiteId]/settings/WebsiteTransferForm';

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), touch: vi.fn() }));
vi.mock('@/components/hooks', () => ({
  useMessages: () => ({
    t: (label: string) => label,
    labels: {},
    messages: {},
    getErrorMessage: () => null,
  }),
  useUpdateQuery: () => ({ mutateAsync: mocks.mutate }),
  useDeleteQuery: () => ({ mutateAsync: mocks.mutate, touch: mocks.touch }),
  useLoginQuery: () => ({ user: { id: 'user' } }),
  useWebsite: () => ({ teamId: 'team' }),
  useUserTeamsQuery: () => ({ data: { data: [] } }),
}));
vi.mock('@/components/common/TypeConfirmationForm', () => ({
  TypeConfirmationForm: ({ onConfirm }: any) => <button onClick={onConfirm}>confirm</button>,
}));
vi.mock('@umami/react-zen', () => ({
  Form: ({ onSubmit }: any) => <button onClick={() => onSubmit({})}>confirm</button>,
  Button: () => null,
  FormButtons: () => null,
  FormField: () => null,
  FormSubmitButton: () => null,
  ListItem: () => null,
  Loading: () => null,
  Select: () => null,
  Text: () => null,
}));
beforeEach(() => {
  mocks.mutate.mockImplementation(async (_data, options) => options.onSuccess());
});

it.each([WebsiteResetForm, WebsiteDeleteForm, WebsiteTransferForm])(
  'invalidates cached website data on native lifecycle success (%#)',
  async Form => {
    const client = new QueryClient();
    const keys = [
      ['liekan', 'site', 'overview'],
      ['liekan-feature', 'user', 'site', 'site'],
      ['liekan-feature', 'user', 'sites'],
      ['liekan-feature', 'user', 'summary', ['site']],
    ];
    for (const key of keys) client.setQueryData(key, { cached: true });
    client.setQueryData(['liekan', 'unrelated', 'overview'], { cached: true });
    const saved = vi.fn();
    render(
      <QueryClientProvider client={client}>
        <Form websiteId="site" onSave={saved} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText('confirm'));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(client.getQueryState(['liekan', 'unrelated', 'overview'])?.isInvalidated).toBe(false);
  },
);
