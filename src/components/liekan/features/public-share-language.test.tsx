import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { LiekanLocaleContext } from '@/lib/liekan/i18n/client';
import { PublicShareEntry } from './PublicShareEntry';

const mocks = vi.hoisted(() => ({ legacy: false }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/share/slug',
  useSearchParams: () => new URLSearchParams(mocks.legacy ? 'legacy=1' : ''),
}));
vi.mock('@/lib/liekan/upstream/share-client', () => ({
  ShareProvider: ({ children }) => <>{children}</>,
}));
vi.mock('@/lib/liekan/upstream/features-client', () => ({
  featureRequest: vi.fn(async () => ({ requiresPassword: false })),
}));
vi.mock('./WorkspacePages', () => ({ ShareFeatureView: () => <main>Public share</main> }));

it.each([false, true])(
  'offers the same language entry on public shares (legacy=%s)',
  async legacy => {
    mocks.legacy = legacy;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <LiekanLocaleContext.Provider value="en-US">
          <PublicShareEntry slug="slug">
            <main>Legacy share</main>
          </PublicShareEntry>
        </LiekanLocaleContext.Provider>
      </QueryClientProvider>,
    );
    try {
      expect(screen.getByRole('combobox', { name: 'Language / 语言' })).toHaveValue('en-US');
      expect(await screen.findByRole('main')).toHaveTextContent(
        legacy ? 'Legacy share' : 'Public share',
      );
    } finally {
      view.unmount();
      client.clear();
    }
  },
);
