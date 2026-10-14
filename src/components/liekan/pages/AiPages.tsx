import { useLiekanI18n } from '@/lib/liekan/i18n/client';
import {
  FilterChip,
  MetricCard,
  ReferenceChart,
  ReportList,
  ReportRows,
  SortHeading,
} from '../ReportComponents';
import type { ReportViewProps } from '../types';

export function AiPages({ report, rangeLabel }: ReportViewProps) {
  const i18n = useLiekanI18n();
  return (
    <main className="max-w-[1200px] mx-auto px-8 py-6 space-y-4">
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          label="被 AI 抓取页面"
          className="card p-4 fade-in d1"
          valueClass="num text-[24px] font-bold text-brand mt-1.5"
          report={report}
        />
        <MetricCard
          label="反复抓取页面"
          className="card p-4 fade-in d1"
          valueClass="num text-[24px] font-bold text-up mt-1.5"
          report={report}
        />
        <MetricCard
          label="从未被抓页面"
          className="card p-4 fade-in d1"
          valueClass="num text-[24px] font-bold text-up mt-1.5"
          report={report}
        />
        <MetricCard
          label="平均抓取深度"
          className="card p-4 fade-in d1"
          valueClass="num text-[24px] font-bold text-brand mt-1.5"
          report={report}
        />
      </section>
      <section className="card fade-in d2 overflow-hidden">
        <div className="px-6 py-4 border-b border-line flex items-center justify-between gap-3">
          <h2 className="text-[14px] font-bold tracking-tight">
            {i18n.fragment('AI 抓取页面排行（', false, true)}
            {i18n.system(rangeLabel)}）
          </h2>
          <div className="flex items-center gap-2">
            <FilterChip label="按抓取量" />
            <FilterChip label="按重复率" />
            <FilterChip label="按蜘蛛数" />
          </div>
        </div>
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[11.5px] text-faint border-b border-line bg-[#FAFBFD]">
              <SortHeading className="font-medium pl-6 pr-4 py-3" label="页面" />
              <SortHeading className="font-medium px-4 py-3 text-right" label="抓取次数" />
              <SortHeading className="font-medium px-4 py-3 text-right" label="蜘蛛种类" />
              <SortHeading className="font-medium px-4 py-3 w-[18%]" label="抓取热度" />
              <SortHeading className="font-medium px-4 py-3" label="主力蜘蛛" />
              <SortHeading className="font-medium px-4 py-3" label="最近抓取" />
              <SortHeading className="font-medium px-4 py-3 text-right pr-6" label="内容新鲜度" />
            </tr>
          </thead>
          <ReportRows table="apBody" report={report} pageSize={20} />
        </table>
      </section>
      <section className="grid grid-cols-2 gap-4">
        <div className="card fade-in d2">
          <div className="px-6 pt-5 pb-2">
            <h2 className="text-[14px] font-bold tracking-tight">
              {i18n.text('目录维度抓取分布')}
            </h2>
            <p className="text-[11.5px] text-faint mt-0.5">
              {i18n.system(rangeLabel)}
              {i18n.fragment(' · 按 URL 一级目录', true, false)}
            </p>
          </div>
          <ReferenceChart id="ap1" height={240} report={report} />
        </div>
        <div className="card fade-in d3 overflow-hidden">
          <div className="px-6 py-4 border-b border-line flex items-center justify-between">
            <h2 className="text-[14px] font-bold tracking-tight">
              {i18n.text('AI 盲区（从未被抓取的页面）')}
            </h2>
            <span className="bd bd-amber">{i18n.text('建议治理')}</span>
          </div>
          <ReportList
            id="blindList"
            className="divide-y divide-line/60 text-[12px]"
            report={report}
            pageSize={20}
          />
        </div>
      </section>
    </main>
  );
}
