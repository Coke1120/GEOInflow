import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { LiekanLocaleContext } from '@/lib/liekan/i18n/client';
import { populationFromRow } from '@/lib/liekan/upstream/browser-population';
import { applyReportPopulation } from '@/lib/liekan/contracts/population-results';
import { MetricCard } from './ReportComponents';
import type { LiekanReport } from './types';

it.each(['zh-CN', 'en-US'] as const)(
  'renders numeric visitor cards and the qualified scope at partial coverage in %s',
  locale => {
    const population = populationFromRow(
      {
        resourceKind: 'website',
        metricScope: 'qualified-browser',
        eligibleEvents: 85,
        qualifiedEvents: 4,
        eligiblePV: 83,
        qualifiedPV: 3,
        qualifiedVisitors: 2,
      },
      { startAt: 0, endAt: 1000, timezone: 'UTC' },
    );
    const report = applyReportPopulation(
      {
        meta: {},
        cards: [
          { key: '访客数 UV', label: '访客数 UV', value: 2, state: 'available' },
          { key: '浏览量 PV', label: '浏览量 PV', value: 3, state: 'available' },
        ],
        charts: {},
        tables: {},
      } as LiekanReport,
      population,
    );
    const html = renderToStaticMarkup(
      <LiekanLocaleContext.Provider value={locale}>
        <MetricCard label="访客数 UV" className="card" valueClass="value" report={report} />
        <MetricCard label="浏览量 PV" className="card" valueClass="value" report={report} />
      </LiekanLocaleContext.Provider>,
    );
    const document = new DOMParser().parseFromString(html, 'text/html');
    expect([...document.querySelectorAll('.value')].map(node => node.textContent)).toEqual([
      '2',
      '3',
    ]);
    expect(document.body.textContent).toContain(
      locale === 'zh-CN' ? '仅统计身份信息完整' : 'complete identity evidence',
    );
  },
);
