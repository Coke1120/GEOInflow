import { FilterChip, ReferenceChart, ReportRows, SortHeading } from '../ReportComponents';
import type { ReportViewProps } from '../types';

export function AiBots({ report, rangeLabel }: ReportViewProps) {
  return (
    <main className="max-w-[1200px] mx-auto px-8 py-6 space-y-4">
      <section className="card fade-in d1 overflow-hidden">
        <div className="px-6 py-4 border-b border-line flex items-center justify-between gap-3">
          <h2 className="text-[14px] font-bold tracking-tight">
            AI 蜘蛛台账（{rangeLabel} 抓取量排序）
          </h2>
          <div className="flex items-center gap-2">
            <FilterChip label="全部" />
            <FilterChip label="AI 训练" />
            <FilterChip label="AI 搜索" />
            <FilterChip label="传统搜索" />
          </div>
        </div>
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[11.5px] text-faint border-b border-line bg-[#FAFBFD]">
              <SortHeading className="font-medium pl-6 pr-4 py-3" label="蜘蛛 / 厂商" />
              <SortHeading className="font-medium px-4 py-3" label="类型" />
              <SortHeading className="font-medium px-4 py-3 text-right" label="30 天抓取" />
              <SortHeading className="font-medium px-4 py-3 text-right" label="日均" />
              <SortHeading className="font-medium px-4 py-3 text-right" label="覆盖页面" />
              <SortHeading className="font-medium px-4 py-3" label="最爱内容" />
              <SortHeading className="font-medium px-4 py-3" label="最后访问" />
              <SortHeading className="font-medium px-4 py-3 text-right pr-6" label="趋势" />
            </tr>
          </thead>
          <ReportRows table="botBody" report={report} />
        </table>
      </section>
      <section className="grid grid-cols-2 gap-4">
        <div className="card fade-in d2">
          <div className="px-6 pt-5 pb-2">
            <h2 className="text-[14px] font-bold tracking-tight">蜘蛛类型构成</h2>
            <p className="text-[11.5px] text-faint mt-0.5">AI 训练 / AI 搜索 / 传统搜索</p>
          </div>
          <ReferenceChart id="b1" height={230} report={report} />
        </div>
        <div className="card fade-in d3 p-5">
          <h2 className="text-[14px] font-bold tracking-tight">识别口径</h2>
          <div className="mt-3 space-y-2.5 text-[12px] text-sub leading-relaxed">
            <p>
              依据导入日志的 User-Agent
              特征分类。匹配结果标记为估算，来源身份验证信息仅在有证据时显示。
            </p>
            <p>管理特征库可以调整本地识别规则。</p>
          </div>
        </div>
      </section>
    </main>
  );
}
