import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./server', () => ({ query: vi.fn(), LiekanError: class extends Error {} }));

import { getContentImpact, getMonthlyAiShare, isStaticRequestPath } from './logs';
import { query } from './server';

beforeEach(() => vi.resetAllMocks());

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
describe('content impact path boundary', () => {
  it('binds decoded upstream paths while retaining imported paths for log evidence', async () => {
    const importedPath = '/%E6%96%87%E6%A1%A3/AI%20%E5%85%A5%E9%97%A8';
    vi.mocked(query).mockResolvedValueOnce([
      { path: importedPath, publishedAt: '2026-09-01T00:00:00Z' },
    ]);
    vi.mocked(query).mockResolvedValueOnce([{ path: importedPath, pv: 7, increment: 3 }]);
    expect(await getContentImpact('site', new Date('2026-09-01'), new Date('2026-09-30'))).toEqual([
      { path: importedPath, pv: 7, increment: 3 },
    ]);
    const targets = JSON.parse(vi.mocked(query).mock.calls[1][2] as string);
    expect(targets).toEqual([
      { path: importedPath, humanPath: '/文档/AI 入门', publishedAt: '2026-09-01T00:00:00Z' },
    ]);
  });
});
describe('monthly AI share calendar', () => {
  it('returns six consecutive months across the year with unobserved gaps', async () => {
    vi.mocked(query).mockResolvedValueOnce([
      { month: '2025-09', total: 5, ai: 0 },
      { month: '2026-02', total: 2, ai: 1 },
    ]);
    expect(
      await getMonthlyAiShare('site', new Date('2026-02-15T00:00:00Z'), 'Asia/Shanghai'),
    ).toEqual([
      { month: '2025-09', total: 5, ai: 0 },
      { month: '2025-10', total: 0, ai: 0 },
      { month: '2025-11', total: 0, ai: 0 },
      { month: '2025-12', total: 0, ai: 0 },
      { month: '2026-01', total: 0, ai: 0 },
      { month: '2026-02', total: 2, ai: 1 },
    ]);
    vi.mocked(query).mockResolvedValueOnce([]);
    expect(
      (
        await getMonthlyAiShare('site', new Date('2026-01-01T04:00:00Z'), 'America/Los_Angeles')
      ).map(row => row.month),
    ).toEqual(['2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12']);
  });
});
