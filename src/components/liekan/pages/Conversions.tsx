import { MetricCard, ReferenceChart, ReportRows, SortHeading } from '../ReportComponents';
import type { ReportViewProps } from '../types';

export function Conversions({ report, rangeLabel }: ReportViewProps) {
  return (
    <main className="max-w-[1200px] mx-auto px-8 py-6 space-y-4">
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          label="全站转化率"
          className="card p-4 fade-in d1"
          valueClass="num text-[24px] font-bold text-brand mt-1.5"
          report={report}
        />
        <MetricCard
          label="今日转化"
          className="card p-4 fade-in d1"
          valueClass="num text-[24px] font-bold text-brand mt-1.5"
          report={report}
        />
        <MetricCard
          label="转化页 TOP1"
          className="card p-4 fade-in d1"
          valueClass="num text-[24px] font-bold text-brand mt-1.5"
          report={report}
        />
        <MetricCard
          label="白皮书下载"
          className="card p-4 fade-in d1"
          valueClass="num text-[24px] font-bold text-brand mt-1.5"
          report={report}
        />
      </section>
      <section className="grid grid-cols-5 gap-4">
        <div className="card col-span-2 fade-in d2">
          <div className="px-6 pt-5 pb-2">
            <h2 className="text-[14px] font-bold tracking-tight">主转化漏斗（{rangeLabel}）</h2>
            <p className="text-[11.5px] text-faint mt-0.5">
              {report?.charts.f1?.labels.length
                ? report.charts.f1.labels.join(' → ')
                : '转化漏斗待配置'}
            </p>
          </div>
          <ReferenceChart id="f1" height={290} report={report} />
        </div>
        <div className="card col-span-3 fade-in d3 overflow-hidden">
          <div className="px-6 py-4 border-b border-line">
            <h2 className="text-[14px] font-bold tracking-tight">转化目标明细</h2>
          </div>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[11.5px] text-faint border-b border-line bg-[#FAFBFD]">
                <SortHeading className="font-medium pl-6 pr-4 py-3" label="转化目标" />
                <SortHeading className="font-medium px-4 py-3 text-right" label="次数" />
                <SortHeading className="font-medium px-4 py-3 text-right" label="转化率" />
                <SortHeading className="font-medium px-4 py-3 text-right" label="环比" />
                <SortHeading className="font-medium px-4 py-3 text-right pr-6" label="主承接页" />
              </tr>
            </thead>
            <ReportRows table="goalBody" report={report} />
          </table>
        </div>
      </section>
      <section className="grid grid-cols-2 gap-4">
        <div className="card fade-in d2">
          <div className="px-6 pt-5 pb-2">
            <h2 className="text-[14px] font-bold tracking-tight">渠道转化率对比</h2>
            <p className="text-[11.5px] text-faint mt-0.5">{rangeLabel} · 按来源渠道</p>
          </div>
          <ReferenceChart id="f2" height={250} report={report} />
        </div>
        <div className="card fade-in d3">
          <div className="px-6 pt-5 pb-2">
            <h2 className="text-[14px] font-bold tracking-tight">转化趋势</h2>
            <p className="text-[11.5px] text-faint mt-0.5">{rangeLabel} · 转化次数/天</p>
          </div>
          <ReferenceChart id="f3" height={250} report={report} />
        </div>
      </section>
    </main>
  );
}
