import { formatPercentage, formatValue, stateLabels } from '../data';
import { MetricCard, ReferenceChart, ReportRows, SortHeading } from '../ReportComponents';
import type { ReportViewProps } from '../types';

export function HumanSources({ report, rangeLabel }: ReportViewProps) {
  const aiRows = report?.tables.srcBody?.filter(row => row.channel === 'AI 搜索引荐') || [];
  const sessions = aiRows.reduce((sum, row) => sum + Number(row.sessions || 0), 0);
  const bounceRows = aiRows.filter(
    row => typeof row.bounceRate === 'number' && typeof row.sessions === 'number',
  );
  const measuredSessions = bounceRows.reduce((sum, row) => sum + Number(row.sessions), 0);
  const bounceRate = measuredSessions
    ? bounceRows.reduce((sum, row) => sum + Number(row.bounceRate) * Number(row.sessions), 0) /
      measuredSessions
    : null;
  const conversion = report?.cards.find(card => card.label === 'AI 引荐转化率');
  return (
    <main className="max-w-[1200px] mx-auto px-8 py-6 space-y-4">
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          label="直接访问"
          className="card p-4 fade-in d1"
          valueClass="num text-[24px] font-bold text-brand mt-1.5"
          report={report}
        />
        <MetricCard
          label="传统搜索"
          className="card p-4 fade-in d1"
          valueClass="num text-[24px] font-bold text-brand mt-1.5"
          report={report}
        />
        <MetricCard
          label="AI 搜索引荐"
          className="card p-4 fade-in d1"
          valueClass="num text-[24px] font-bold text-up mt-1.5"
          report={report}
        />
        <MetricCard
          label="AI 引荐转化率"
          className="card p-4 fade-in d1"
          valueClass="num text-[24px] font-bold text-down mt-1.5"
          report={report}
        />
      </section>
      <section className="grid grid-cols-3 gap-4">
        <div className="card col-span-2 fade-in d2">
          <div className="px-6 pt-5 pb-2">
            <h2 className="text-[14px] font-bold tracking-tight">渠道趋势（AI 搜索引荐单列）</h2>
            <p className="text-[11.5px] text-faint mt-0.5">{rangeLabel} · 会话数/天</p>
          </div>
          <ReferenceChart id="s1" height={260} report={report} />
        </div>
        <div className="card fade-in d3">
          <div className="px-6 pt-5 pb-2">
            <h2 className="text-[14px] font-bold tracking-tight">AI 引荐平台构成</h2>
            <p className="text-[11.5px] text-faint mt-0.5">chatgpt / perplexity / 豆包 等</p>
          </div>
          <ReferenceChart id="s2" height={260} report={report} />
        </div>
      </section>
      <section className="card fade-in d2 overflow-hidden">
        <div className="px-6 py-4 border-b border-line flex items-center justify-between">
          <h2 className="text-[14px] font-bold tracking-tight">来源明细（Referer 维度）</h2>
          <span className="text-[11.5px] text-faint">会话首个 Referer · 按来源归类</span>
        </div>
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[11.5px] text-faint border-b border-line bg-[#FAFBFD]">
              <SortHeading className="font-medium pl-6 pr-4 py-3" label="来源" />
              <SortHeading className="font-medium px-4 py-3" label="渠道归类" />
              <SortHeading className="font-medium px-4 py-3 text-right" label="会话" />
              <SortHeading className="font-medium px-4 py-3 w-[16%]" label="占比" />
              <SortHeading className="font-medium px-4 py-3 text-right" label="跳出率" />
              <SortHeading className="font-medium px-4 py-3 text-right" label="转化率" />
              <SortHeading className="font-medium px-4 py-3 text-right pr-6" label="环比" />
            </tr>
          </thead>
          <ReportRows table="srcBody" report={report} />
        </table>
      </section>
      <section className="rounded-xl bg-wash p-4 fade-in d3">
        <p className="text-[12px] text-sub leading-relaxed">
          <b className="text-ink">GEO 洞察：</b>
          {sessions
            ? `当前范围识别 ${formatValue(sessions)} 次 AI 引荐会话；跳出率 ${formatPercentage(bounceRate)}，转化率 ${formatPercentage(conversion?.value)}。`
            : !report || report.states.human === 'not_connected'
              ? '引荐数据待接入。'
              : '当前范围暂无可识别的 AI 引荐会话。'}
          {conversion?.value == null
            ? `转化指标${stateLabels[conversion?.state || 'not_connected']}。`
            : ''}
          引荐依据会话首个 Referer 归类；抓取频率与 AI 引用量的关系尚缺引用证据。
        </p>
      </section>
    </main>
  );
}
