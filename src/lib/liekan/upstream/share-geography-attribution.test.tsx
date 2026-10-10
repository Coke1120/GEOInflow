import { expect, test, vi } from 'vitest';
import { render, screen } from '@/test/render';
import { ShareFooter } from '@/app/share/[slug]/[[...path]]/ShareFooter';

const { share } = vi.hoisted(() => ({ share: { whiteLabel: false } }));
vi.mock('@/components/hooks', () => ({ useShare: () => share }));
vi.mock('@/app/share/[slug]/[[...path]]/ShareBranding', () => ({
  ShareBranding: () => <span>Product branding</span>,
}));

test.each([false, true])(
  'public shares retain DB-IP attribution with product branding set to %s',
  whiteLabel => {
    share.whiteLabel = whiteLabel;
    render(<ShareFooter />);
    expect(screen.getByRole('link', { name: 'IP Geolocation by DB-IP' })).toHaveAttribute(
      'href',
      'https://db-ip.com',
    );
    if (whiteLabel) expect(screen.getByText('Product branding')).toBeInTheDocument();
    else expect(screen.queryByText('Product branding')).toBeNull();
  },
);
