import { useLiekanI18n } from '@/lib/liekan/i18n/client';
import { geographyCoverageText } from '@/lib/liekan/contracts/geography';
import { MetricCard, ReferenceChart, ReportRows, SortHeading } from '../ReportComponents';
import type { ReportViewProps } from '../types';

export function HumanGeo({ report, rangeLabel }: ReportViewProps) {
  const i18n = useLiekanI18n();
  return (
    <main className="max-w-[1200px] mx-auto px-8 py-6 space-y-4">
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          label="覆盖省份"
          className="card p-4 fade-in d1"
          valueClass="num text-[24px] font-bold text-brand mt-1.5"
          report={report}
        />
        <MetricCard
          label="海外国家/地区"
          className="card p-4 fade-in d1"
          valueClass="num text-[24px] font-bold text-brand mt-1.5"
          report={report}
        />
        <MetricCard
          label="TOP1 城市"
          className="card p-4 fade-in d1"
          valueClass="num text-[24px] font-bold text-brand mt-1.5"
          report={report}
        />
        <MetricCard
          label="海外 TOP1"
          className="card p-4 fade-in d1"
          valueClass="num text-[24px] font-bold text-brand mt-1.5"
          report={report}
        />
      </section>
      <section className="grid grid-cols-3 gap-4">
        <div className="card col-span-2 fade-in d2">
          <div className="px-6 pt-5 pb-2">
            <h2 className="text-[14px] font-bold tracking-tight">
              {i18n.text('国内省份分布 TOP10')}
            </h2>
            <p className="text-[11.5px] text-faint mt-0.5">
              {i18n.system(rangeLabel)}
              {i18n.fragment(' · 按会话数（含转化率）', true, false)}
            </p>
          </div>
          <ReferenceChart id="g1" height={300} report={report} />
        </div>
        <div className="card fade-in d3">
          <div className="px-6 pt-5 pb-2">
            <h2 className="text-[14px] font-bold tracking-tight">
              {i18n.text('海外国家/地区 TOP8')}
            </h2>
            <p className="text-[11.5px] text-faint mt-0.5">
              {i18n.system(rangeLabel)}
              {i18n.fragment(' · 按会话数', true, false)}
            </p>
          </div>
          <ReferenceChart id="g2" height={300} report={report} />
        </div>
      </section>
      <section className="card fade-in d2 overflow-hidden">
        <div className="px-6 py-4 border-b border-line flex items-center justify-between">
          <h2 className="text-[14px] font-bold tracking-tight">{i18n.text('城市明细')}</h2>
          <span className="text-[11.5px] text-faint">
            {i18n.system(geographyCoverageText(report?.meta.geographyCoverage))}
          </span>
        </div>
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[11.5px] text-faint border-b border-line bg-[#FAFBFD]">
              <SortHeading className="font-medium pl-6 pr-4 py-3" label="城市" />
              <SortHeading className="font-medium px-4 py-3 text-right" label="会话" />
              <SortHeading className="font-medium px-4 py-3 w-[22%]" label="占比" />
              <SortHeading className="font-medium px-4 py-3 text-right" label="平均时长" />
              <SortHeading className="font-medium px-4 py-3 text-right" label="跳出率" />
              <SortHeading className="font-medium px-4 py-3 text-right pr-6" label="转化率" />
            </tr>
          </thead>
          <ReportRows table="cityBody" report={report} pageSize={20} />
        </table>
      </section>
    </main>
  );
}
