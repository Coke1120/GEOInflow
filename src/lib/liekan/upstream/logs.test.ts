import { describe, expect, it, vi } from 'vitest';

vi.mock('./server', () => ({ query: vi.fn(), LiekanError: class extends Error {} }));

import { isStaticRequestPath } from './logs';

describe('today request content boundary', () => {
  it('excludes static assets while preserving document and extension boundaries', () => {
    for (const path of [
      '/app.js',
      '/app.MJS',
      '/app.css',
      '/app.js.map',
      '/cover.JPG',
      '/x.webp',
      '/icon.svg',
      '/font.woff2',
      '/clip.mp4',
      '/app.js?v=1',
    ])
      expect(isStaticRequestPath(path), path).toBe(true);
    for (const path of [
      '/article.html',
      '/report.pdf',
      '/data.json',
      '/sitemap.xml',
      '/feed.txt',
      '/app.js/guide',
      '/notjs',
      '/index.js-extra',
      '/',
    ])
      expect(isStaticRequestPath(path), path).toBe(false);
  });
});
