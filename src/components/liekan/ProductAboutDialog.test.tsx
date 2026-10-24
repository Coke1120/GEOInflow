import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { LiekanLocaleContext } from '@/lib/liekan/i18n/client';
import { ProductAboutDialog } from './ProductAboutDialog';

vi.mock('next/link', () => ({
  default: ({ children, prefetch: _prefetch, onClick, ...props }: any) => (
    <a
      {...props}
      onClick={event => {
        event.preventDefault();
        onClick?.(event);
      }}
    >
      {children}
    </a>
  ),
}));

it.each(['zh-CN', 'en-US'] as const)(
  'shows the pending contributor state and attributed publisher links in %s',
  async locale => {
    const onClose = vi.fn();
    render(
      <LiekanLocaleContext.Provider value={locale}>
        <ProductAboutDialog onClose={onClose} />
      </LiekanLocaleContext.Provider>,
    );
    const dialog = within(await screen.findByRole('dialog'));
    expect(
      dialog.getByText(
        locale === 'zh-CN' ? 'GitHub 仓库待接入' : 'GitHub repository not connected',
      ),
    ).toBeVisible();
    expect(dialog.getByText('v1.2')).toBeVisible();
    for (const [name, href] of [
      ['猎看科技', 'https://www.liekan.com/?GEOInflow'],
      ['北京日报社智源GEO', 'https://geo.takefoto.cn/?GEOInflow'],
      [locale === 'zh-CN' ? '姚金刚的 X 主页' : '姚金刚 on X', 'https://x.com/yaojingang'],
      [locale === 'zh-CN' ? '向阳乔木的 X 主页' : '向阳乔木 on X', 'https://x.com/vista8'],
    ]) {
      const link = dialog.getByRole('link', { name });
      expect(link).toHaveAttribute('href', href);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
    expect(dialog.queryByText(/贡献者 \d|Contributor \d|排版示意/)).toBeNull();
    expect(dialog.queryByRole('link', { name: 'GitHub' })).toBeNull();
    const about = dialog.getByRole('link', {
      name: locale === 'zh-CN' ? '项目说明' : 'About GEOInflow',
    });
    expect(about).toHaveAttribute('href', '/liekan/help?article=project-about');
    fireEvent.click(about);
    expect(onClose).toHaveBeenCalledOnce();
  },
);
