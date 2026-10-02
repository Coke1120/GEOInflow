import {
  FilterChip,
  InsightRows,
  MetricCard,
  ReferenceChart,
  ReportRows,
  SortHeading,
} from '../ReportComponents';
import type { ReportViewProps } from '../types';

export function Overview({ report, rangeLabel, trendLabel }: ReportViewProps) {
  return (
    <main className="max-w-[1200px] mx-auto px-8 py-6 space-y-4">
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          label="今日总请求"
          className="card p-4 fade-in d1"
          valueClass="num text-[24px] font-bold text-brand mt-1.5"
          report={report}
        />
        <MetricCard
          label="人类访客（UV）"
          className="card p-4 fade-in d1"
          valueClass="num text-[24px] font-bold text-down mt-1.5"
          report={report}
        />
        <MetricCard
          label="AI 蜘蛛请求"
          className="card p-4 fade-in d1"
          valueClass="num text-[24px] font-bold text-up mt-1.5"
          report={report}
        />
        <MetricCard
          label="今日转化"
          className="card p-4 fade-in d1"
          valueClass="num text-[24px] font-bold text-brand mt-1.5"
          report={report}
        />
      </section>
      <section className="card fade-in d2">
        <div className="px-6 pt-5 pb-2 flex items-center justify-between">
          <div>
            <h2 className="text-[14px] font-bold tracking-tight">AI 蜘蛛 vs 人类访问趋势</h2>
            <p className="text-[11.5px] text-faint mt-0.5">
              {trendLabel || rangeLabel} · 浏览器 PV / 日志 AI 请求
            </p>
          </div>
          <div className="flex items-center gap-2">
            <FilterChip label="30 天" />
            <FilterChip label="7 天" />
            <FilterChip label="24h" />
          </div>
        </div>
        <ReferenceChart id="d1" height={280} report={report} />
      </section>
      <section className="grid grid-cols-3 gap-4">
        <div className="card fade-in d2">
          <div className="px-6 pt-5 pb-2">
            <h2 className="text-[14px] font-bold tracking-tight">AI 蜘蛛构成</h2>
            <p className="text-[11.5px] text-faint mt-0.5">{rangeLabel} · 按请求量</p>
          </div>
          <ReferenceChart id="d2" height={250} report={report} />
        </div>
        <div className="card fade-in d2">
          <div className="px-6 pt-5 pb-2">
            <h2 className="text-[14px] font-bold tracking-tight">人类来源渠道</h2>
            <p className="text-[11.5px] text-faint mt-0.5">{rangeLabel} · 按会话</p>
          </div>
          <ReferenceChart id="d3" height={250} report={report} />
        </div>
        <div className="card fade-in d3">
          <div className="px-6 pt-5 pb-2">
            <h2 className="text-[14px] font-bold tracking-tight">GEO 关键发现</h2>
          </div>
          <InsightRows
            className="px-6 pb-5 space-y-2.5 text-[12px] text-sub leading-relaxed"
            report={report}
          />
        </div>
      </section>
      <section className="card fade-in d3 overflow-hidden">
        <div className="px-6 py-4 border-b border-line flex items-center justify-between">
          <h2 className="text-[14px] font-bold tracking-tight">
            页面双视角 TOP（AI 抓取 × 人类访问）
          </h2>
          <span className="text-[11.5px] text-faint">{rangeLabel} · 按 PV / 抓取次数</span>
        </div>
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[11.5px] text-faint border-b border-line bg-[#FAFBFD]">
              <SortHeading className="font-medium pl-6 pr-4 py-3" label="页面" />
              <SortHeading className="font-medium px-4 py-3 text-right" label="人类 PV" />
              <SortHeading className="font-medium px-4 py-3 text-right" label="AI 抓取" />
              <SortHeading className="font-medium px-4 py-3 text-right" label="AI/人 比值" />
              <SortHeading className="font-medium px-4 py-3" label="最活跃蜘蛛" />
              <SortHeading className="font-medium px-4 py-3 text-right pr-6" label="GEO 评价" />
            </tr>
          </thead>
          <ReportRows table="topBody" report={report} />
        </table>
      </section>
    </main>
  );
}
