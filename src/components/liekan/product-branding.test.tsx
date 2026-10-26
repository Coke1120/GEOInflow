import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiekanLocaleContext } from '@/lib/liekan/i18n/client';
import { ShareBranding } from '@/app/share/[slug]/[[...path]]/ShareBranding';
import { ProductFooter } from './ProductFooter';

const share = vi.hoisted(() => ({
  whiteLabel: undefined as
    | undefined
    | {
        displayName?: string;
        domainName?: string;
        logoUrl?: string;
      },
}));
vi.mock('@/components/hooks', () => ({ useShare: () => share }));
vi.mock('./GeographyAttribution', () => ({
  GeographyAttribution: () => <span>IP Geolocation by DB-IP</span>,
}));

beforeEach(() => {
  share.whiteLabel = undefined;
});

it.each(['zh-CN', 'en-US'] as const)(
  'preserves the approved product and publisher names in %s',
  locale => {
    render(
      <LiekanLocaleContext.Provider value={locale}>
        <ProductFooter />
      </LiekanLocaleContext.Provider>,
    );
    expect(screen.getByRole('link', { name: 'GEOInflow v1.2' })).toHaveAttribute(
      'href',
      '/liekan/help?article=project-changelog',
    );
    const publishers = document.querySelector('[data-product-publishers]');
    expect(Array.from(publishers?.children || []).map(child => child.textContent)).toEqual([
      locale === 'zh-CN' ? '联合发布：' : 'Jointly published by:',
      '猎看科技',
      '北京日报社智源GEO',
    ]);
    const license = screen.getByRole('link', { name: 'MIT' });
    expect(license).toBeInTheDocument();
    expect(license.nextElementSibling).toBe(screen.getByRole('link', { name: 'Umami' }));
    expect(screen.getByText('IP Geolocation by DB-IP')).toBeInTheDocument();
    for (const [name, href] of [
      ['Umami', 'https://github.com/umami-software/umami'],
      ['猎看科技', 'https://www.liekan.com/?GEOInflow'],
      ['北京日报社智源GEO', 'https://geo.takefoto.cn/?GEOInflow'],
      ['姚金刚', 'https://x.com/yaojingang'],
      ['向阳乔木', 'https://x.com/vista8'],
    ]) {
      const link = screen.getByRole('link', { name });
      expect(link).toHaveAttribute('href', href);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
    expect(screen.queryByRole('link', { name: /作者 X|Author on X/ })).toBeNull();
  },
);

it('uses GEOInflow on an uncustomized share without an external branding destination', () => {
  const { container } = render(<ShareBranding />);
  expect(screen.getByText('GEOInflow')).toBeInTheDocument();
  expect(container.querySelector('img')).toHaveAttribute('src', '/liekan/features/logo.svg');
  expect(container.querySelector('a')).toBeNull();
});

it('preserves all custom share branding values', () => {
  share.whiteLabel = {
    displayName: '客户统计',
    domainName: 'https://customer.example',
    logoUrl: 'https://customer.example/logo.svg',
  };
  const { container } = render(<ShareBranding />);
  expect(screen.getByRole('link', { name: '客户统计' })).toHaveAttribute(
    'href',
    'https://customer.example',
  );
  expect(container.querySelector('img')).toHaveAttribute('src', share.whiteLabel.logoUrl);
  expect(container.querySelector('a')).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.queryByText('GEOInflow')).toBeNull();
});

it('fills only absent custom brand values', () => {
  share.whiteLabel = { displayName: '客户统计' };
  const { container } = render(<ShareBranding />);
  expect(screen.getByText('客户统计')).toBeInTheDocument();
  expect(container.querySelector('img')).toHaveAttribute('src', '/liekan/features/logo.svg');
  expect(container.querySelector('a')).toBeNull();
});
