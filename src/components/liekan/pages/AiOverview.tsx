import { MetricCard, ReferenceChart, ReportList } from '../ReportComponents';
import type { ReportViewProps } from '../types';

export function AiOverview({ report, rangeLabel }: ReportViewProps) {
  return (
    <main className="max-w-[1200px] mx-auto px-8 py-6 space-y-4">
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          label="AI 蜘蛛请求（30天）"
          className="card p-4 fade-in d1"
          valueClass="num text-[24px] font-bold text-up mt-1.5"
          report={report}
        />
        <MetricCard
          label="识别 AI 蜘蛛"
          className="card p-4 fade-in d1"
          valueClass="num text-[24px] font-bold text-brand mt-1.5"
          report={report}
        />
        <MetricCard
          label="AI 抓取页面覆盖率"
          className="card p-4 fade-in d1"
          valueClass="num text-[24px] font-bold text-brand mt-1.5"
          report={report}
        />
        <MetricCard
          label="单页日均最高抓取"
          className="card p-4 fade-in d1"
          valueClass="num text-[24px] font-bold text-brand mt-1.5"
          report={report}
        />
      </section>
      <section className="grid grid-cols-3 gap-4">
        <div className="card col-span-2 fade-in d2">
          <div className="px-6 pt-5 pb-2">
            <h2 className="text-[14px] font-bold tracking-tight">各 AI 蜘蛛抓取趋势</h2>
            <p className="text-[11.5px] text-faint mt-0.5">{rangeLabel} · 次/天 · Top 5</p>
          </div>
          <ReferenceChart id="a1" height={260} report={report} />
        </div>
        <div className="card fade-in d3">
          <div className="px-6 pt-5 pb-2">
            <h2 className="text-[14px] font-bold tracking-tight">AI vs 人类占比演化</h2>
            <p className="text-[11.5px] text-faint mt-0.5">近 6 个月 · AI 请求占比</p>
          </div>
          <ReferenceChart id="a2" height={260} report={report} />
        </div>
      </section>
      <section className="grid grid-cols-3 gap-4">
        <div className="card fade-in d2">
          <div className="px-6 pt-5 pb-2">
            <h2 className="text-[14px] font-bold tracking-tight">AI 抓取时段分布</h2>
            <p className="text-[11.5px] text-faint mt-0.5">{rangeLabel} · 24h 聚合</p>
          </div>
          <ReferenceChart id="a3" height={220} report={report} />
        </div>
        <div className="card fade-in d3">
          <div className="px-6 pt-5 pb-2">
            <h2 className="text-[14px] font-bold tracking-tight">AI 抓取响应状态</h2>
            <p className="text-[11.5px] text-faint mt-0.5">{rangeLabel} · HTTP 状态码</p>
          </div>
          <ReferenceChart id="a4" height={220} report={report} />
        </div>
        <div className="card fade-in d3 p-5">
          <h2 className="text-[14px] font-bold tracking-tight">robots.txt 策略</h2>
          <ReportList
            id="robotsList"
            className="mt-3 space-y-2 text-[11.5px] leading-relaxed"
            report={report}
            pageSize={5}
          />
        </div>
      </section>
    </main>
  );
}
