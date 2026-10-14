import { useLiekanI18n } from '@/lib/liekan/i18n/client';
import {
  FilterChip,
  MetricCard,
  ReferenceChart,
  ReportList,
  ReportRows,
  SortHeading,
} from '../ReportComponents';
import { formatValue, tableLimits } from '../data';
import type { ReportViewProps } from '../types';

export function Content({ report, aiCrawlerEnabled }: ReportViewProps) {
  const i18n = useLiekanI18n();
  const crawlerEnabled = aiCrawlerEnabled !== false && report?.meta.aiCrawlerEnabled !== false;
  const journeyTotal = (report?.tables.journeyList ?? [])
    .slice(0, tableLimits.journeyList)
    .reduce((sum, row) => sum + (Number(row.count) || 0), 0);
  return (
    <main className="max-w-[1200px] mx-auto px-8 py-6 space-y-4">
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          label="有流量页面"
          className="card p-4 fade-in d1"
          valueClass="num text-[24px] font-bold text-brand mt-1.5"
          report={report}
        />
        <MetricCard
          label="入口页 TOP1"
          className="card p-4 fade-in d1"
          valueClass="num text-[24px] font-bold text-brand mt-1.5"
          report={report}
        />
        <MetricCard
          label="退出页 TOP1"
          className="card p-4 fade-in d1"
          valueClass="num text-[24px] font-bold text-brand mt-1.5"
          report={report}
        />
        <MetricCard
          label="内容页平均停留"
          className="card p-4 fade-in d1"
          valueClass="num text-[24px] font-bold text-brand mt-1.5"
          report={report}
        />
      </section>
      <section className="card fade-in d2 overflow-hidden">
        <div className="px-6 py-4 border-b border-line flex items-center justify-between gap-3">
          <h2 className="text-[14px] font-bold tracking-tight">
            {i18n.text('页面排行（人类访问）')}
          </h2>
          <div className="flex items-center gap-2">
            <FilterChip label="按 PV" />
            <FilterChip label="按入口" />
            <FilterChip label="按时长" />
          </div>
        </div>
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[11.5px] text-faint border-b border-line bg-[#FAFBFD]">
              <SortHeading className="font-medium pl-6 pr-4 py-3" label="页面" />
              <SortHeading className="font-medium px-4 py-3 text-right" label="PV" />
              <SortHeading className="font-medium px-4 py-3 text-right" label="UV" />
              <SortHeading className="font-medium px-4 py-3 text-right" label="入口数" />
              <SortHeading className="font-medium px-4 py-3 text-right" label="平均停留" />
              <SortHeading className="font-medium px-4 py-3 text-right" label="跳出率" />
              {crawlerEnabled && (
                <SortHeading className="font-medium px-4 py-3 text-right pr-6" label="AI 抓取" />
              )}
            </tr>
          </thead>
          <ReportRows
            table={crawlerEnabled ? 'pgBody' : 'visitorPgBody'}
            report={report}
            pageSize={20}
          />
        </table>
      </section>
      <section className="card fade-in d2">
        <div className="px-6 pt-5 pb-2 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-bold tracking-tight">
              {i18n.text('站内访问路径 TOP6')}
            </h2>
            <p className="text-[11.5px] text-faint mt-0.5">
              {i18n.text('会话中最常见的页面跳转序列 · 占比按 TOP6 会话合计')}
            </p>
          </div>
          {journeyTotal > 0 && (
            <span className="num text-[11px] text-faint shrink-0 mt-1">
              {i18n.fragment('TOP6 合计 ', false, true)}
              {formatValue(journeyTotal)}
              {i18n.fragment(' 会话', true, false)}
            </span>
          )}
        </div>
        <ReportList id="journeyList" className="px-6 pb-5 pt-2 space-y-2" report={report} />
      </section>
      <section className="card fade-in d3">
        <div className="px-6 pt-5 pb-2">
          <h2 className="text-[14px] font-bold tracking-tight">
            {i18n.text('内容更新与流量响应')}
          </h2>
          <p className="text-[11.5px] text-faint mt-0.5">
            {i18n.text('发布/更新日期 × 随后 7 天流量')}
          </p>
        </div>
        <ReferenceChart id="c1" height={250} report={report} />
      </section>
    </main>
  );
}
