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
    const biographies =
      locale === 'zh-CN'
        ? [
            ['姚金刚', '猎看科技创始人，《AI营销：从SEO到GEO》作者，中国GEO大会发起人'],
            ['向阳乔木', '知名AI自媒体，《AI营销：从SEO到GEO》作者，中国GEO大会发起人'],
            ['任强', '北京日报智源GEO负责人，北京日报京报移动副总经理'],
          ]
        : [
            [
              '姚金刚',
              'Founder of 猎看科技; author of AI营销：从SEO到GEO; initiator of 中国GEO大会',
            ],
            [
              '向阳乔木',
              'Prominent AI content creator; author of AI营销：从SEO到GEO; initiator of 中国GEO大会',
            ],
            ['任强', 'Head of 北京日报智源GEO; Deputy General Manager of 北京日报京报移动'],
          ];
    for (const [name, description] of biographies) {
      const person = dialog.getByText(name).closest('[data-project-initiator]') as HTMLElement;
      expect(within(person).getByText(description)).toBeVisible();
    }
    const ren = dialog.getByText('任强').closest('[data-project-initiator]') as HTMLElement;
    expect(within(ren).queryByRole('link')).toBeNull();

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
    expect(dialog.queryByRole('link', { name: /MIT|Umami/ })).toBeNull();
    const about = dialog.getByRole('link', {
      name: locale === 'zh-CN' ? '项目说明' : 'About GEOInflow',
    });
    expect(about).toHaveAttribute('href', '/liekan/help?article=project-about');
    fireEvent.click(about);
    expect(onClose).toHaveBeenCalledOnce();
  },
);
