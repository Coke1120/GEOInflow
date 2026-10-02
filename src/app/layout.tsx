import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { headers } from 'next/headers';
import { Suspense } from 'react';
import { getBaseUrl } from '@/lib/get-base-url';
import { Providers } from './Providers';
import '@umami/react-zen/styles.full.css';
import './global.css';

const inter = localFont({
  src: '../../public/liekan/fonts/inter-latin.woff2',
  weight: '400 800',
  display: 'swap',
  variable: '--font-inter',
});

export default function ({ children }) {
  if (process.env.DISABLE_UI) {
    return (
      <html>
        <body></body>
      </html>
    );
  }

  return (
    <html lang="zh-CN" className={`${inter.className} ${inter.variable}`}>
      <head>
        <link rel="icon" type="image/svg+xml" href="/liekan/favicon.svg" />
        <link rel="manifest" href="/site.webmanifest" crossOrigin="use-credentials" />
        <meta name="msapplication-TileColor" content="#da532c" />
        <meta name="theme-color" content="#fafafa" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#2f2f2f" media="(prefers-color-scheme: dark)" />
        <meta name="robots" content="noindex,nofollow" />
      </head>
      <body>
        <Suspense>
          <Providers>{children}</Providers>
        </Suspense>
      </body>
    </html>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const headerStore = await headers();

  return {
    metadataBase: getBaseUrl(headerStore),
    title: {
      template: '%s | Liekan 猎看统计',
      default: 'Liekan 猎看统计',
    },
  };
}
