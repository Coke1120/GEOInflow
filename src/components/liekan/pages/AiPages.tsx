import { useLiekanI18n } from '@/lib/liekan/i18n/client';
import { crawlerPageTypes } from '@/lib/liekan/contracts/query';
import { useReportActions } from '../ReportContext';
import { useDataLoading } from '../DataLoading';
import { crawlerIdentityLabel } from '../data';
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
  const { crawlers } = useReportActions();
  const loading = useDataLoading();
  const conditions = crawlers?.conditions ?? {};
  const options = [
    ...new Map(
      (report?.meta.crawlerPageBots ?? [])
        .filter(bot => !conditions.botType || bot.type === conditions.botType)
        .map(bot => [JSON.stringify([bot.botId, bot.name]), bot]),
    ).entries(),
  ];
  const selected =
    conditions.botId || conditions.botName
      ? (options.find(([, bot]) =>
          conditions.botId
            ? bot.botId === conditions.botId
            : !bot.botId && bot.name === conditions.botName,
        )?.[0] ??
        JSON.stringify([conditions.botId ?? null, conditions.botName ?? conditions.botId]))
      : '';
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
        <div className="px-6 py-4 border-b border-line flex crawler-page-controls items-center justify-between gap-3">
          <h2 className="text-[14px] font-bold tracking-tight">
            {i18n.fragment('AI 抓取页面排行（', false, true)}
            {i18n.system(rangeLabel)}）
          </h2>
          <div className="flex crawler-page-controls items-center gap-2">
            <select
              aria-label={i18n.text('具体爬虫')}
              className={`chip${selected ? ' on' : ''}`}
              value={selected}
              disabled={loading}
              onChange={event => {
                const bot = options.find(([key]) => key === event.target.value)?.[1];
                crawlers?.onChange({
                  botType: conditions.botType,
                  botId: (bot?.botId as typeof conditions.botId) ?? undefined,
                  botName: bot && !bot.botId ? bot.name : undefined,
                });
              }}
            >
              <option value="">{i18n.text('全部爬虫')}</option>
              {selected && !options.some(([key]) => key === selected) && (
                <option value={selected}>{conditions.botName ?? conditions.botId}</option>
              )}
              {options.map(([key, bot]) => (
                <option key={key} value={key}>
                  {bot.name} / {crawlerIdentityLabel(bot, i18n.text)}
                </option>
              ))}
            </select>
            <FilterChip label="按抓取量" />
            <FilterChip label="按重复率" />
            <FilterChip label="按蜘蛛数" />
          </div>
        </div>
        <div
          className="px-6 py-4 border-b border-line flex crawler-page-controls items-center gap-2"
          role="group"
          aria-label={i18n.text('爬虫类型')}
        >
          {crawlerPageTypes.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`chip${(conditions.botType ?? '') === value ? ' on' : ''}`}
              aria-pressed={(conditions.botType ?? '') === value}
              disabled={loading}
              onClick={() => crawlers?.onChange({ botType: value || undefined })}
            >
              {i18n.text(label)}
            </button>
          ))}
        </div>
        <table className="crawler-pages-table w-full text-[12.5px]">
          <thead className="whitespace-nowrap">
            <tr className="text-left text-[11.5px] text-faint border-b border-line bg-[#FAFBFD]">
              <SortHeading className="font-medium pl-6 pr-4 py-3" label="页面" />
              <SortHeading className="font-medium px-4 py-3" label="标题" />
              <SortHeading className="font-medium px-4 py-3 text-right" label="抓取次数" />
              <SortHeading className="font-medium px-4 py-3 text-right" label="蜘蛛种类" />
              <SortHeading className="font-medium px-4 py-3 text-right" label="抓取热度" />
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
