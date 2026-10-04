import { InsightRows, MetricCard, ReferenceChart, ReportList } from '../ReportComponents';
import type { ReportViewProps } from '../types';
import { Skeleton, useDataLoading } from '../DataLoading';

export function AiPreference({ report, rangeLabel }: ReportViewProps) {
  const loading = useDataLoading();
  return (
    <main className="max-w-[1200px] mx-auto px-8 py-6 space-y-4">
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          label="AI 最爱内容类型"
          className="card p-4 fade-in d1"
          valueClass="num text-[24px] font-bold text-brand mt-1.5"
          report={report}
        />
        <MetricCard
          label="案例页 AI/人 比值"
          className="card p-4 fade-in d1"
          valueClass="num text-[24px] font-bold text-brand mt-1.5"
          report={report}
        />
        <MetricCard
          label="图文页 vs 交互页"
          className="card p-4 fade-in d1"
          valueClass="num text-[24px] font-bold text-brand mt-1.5"
          report={report}
        />
        <MetricCard
          label="长文平均抓取完成率"
          className="card p-4 fade-in d1"
          valueClass="num text-[24px] font-bold text-brand mt-1.5"
          report={report}
        />
      </section>
      <section className="grid grid-cols-3 gap-4">
        <div className="card col-span-2 fade-in d2">
          <div className="px-6 pt-5 pb-2">
            <h2 className="text-[14px] font-bold tracking-tight">内容类型偏好：AI vs 人类</h2>
            <p className="text-[11.5px] text-faint mt-0.5">{rangeLabel} · 请求占比对比</p>
          </div>
          <ReferenceChart id="pf1" height={260} report={report} />
        </div>
        <div className="card fade-in d3">
          <div className="px-6 pt-5 pb-2">
            <h2 className="text-[14px] font-bold tracking-tight">各蜘蛛内容偏好 TOP1</h2>
          </div>
          <ReportList id="prefList" className="px-6 pb-5 space-y-2" report={report} />
        </div>
      </section>
      <section className="grid grid-cols-2 gap-4">
        <div className="card fade-in d2">
          <div className="px-6 pt-5 pb-2">
            <h2 className="text-[14px] font-bold tracking-tight">抓取路径分析（典型会话）</h2>
            <p className="text-[11.5px] text-faint mt-0.5">
              {loading ? (
                <Skeleton width="65%" />
              ) : report?.tables.pathList?.[0]?.bot ? (
                `${report.tables.pathList[0].bot} 最近抓取顺序 · 会话估算`
              ) : (
                '会话未识别，显示最近 AI 抓取记录'
              )}
            </p>
          </div>
          <ReportList id="pathList" className="px-6 pb-5 pt-2 space-y-2" report={report} />
        </div>
        <div className="card fade-in d3">
          <div className="px-6 pt-5 pb-2">
            <h2 className="text-[14px] font-bold tracking-tight">内容特征与抓取量相关性</h2>
            <p className="text-[11.5px] text-faint mt-0.5">
              字数 / 结构化程度 × {rangeLabel} 抓取量
            </p>
          </div>
          <ReferenceChart id="pf2" height={250} report={report} />
        </div>
      </section>
      <section className="rounded-xl bg-wash p-4 fade-in d3">
        <InsightRows report={report} variant="paragraph" />
      </section>
    </main>
  );
}
