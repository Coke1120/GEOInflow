import { MetricCard, ReferenceChart, ReportRows, SortHeading } from '../ReportComponents';
import { columns } from '../data';
import { useReportActions } from '../ReportContext';
import type { ReportViewProps } from '../types';
import styles from '@/styles/liekan/SearchEngines.module.css';

export function HumanSearchEngines({ report, rangeLabel }: ReportViewProps) {
  const actions = useReportActions();
  return (
    <main className="max-w-[1200px] mx-auto px-8 py-6 space-y-4">
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {['搜索总会话', '传统搜索会话', 'AI 搜索引荐会话', 'AI 搜索占比'].map(label => (
          <MetricCard
            key={label}
            label={label}
            className="card p-4 fade-in d1"
            valueClass="num text-[24px] font-bold text-brand mt-1.5"
            report={report}
          />
        ))}
      </section>
      <section className={styles.charts}>
        {[
          ['se1', '传统搜索引擎占比', '占全部传统搜索会话'],
          ['se2', 'AI 搜索平台占比', '占全部 AI 搜索引荐会话'],
        ].map(([id, title, detail]) => (
          <div className="card fade-in d2" key={id}>
            <div className="px-6 pt-5 pb-2">
              <h2 className="text-[14px] font-bold tracking-tight">{title}</h2>
              <p className="text-[11.5px] text-faint mt-0.5">
                {rangeLabel} · {detail}
              </p>
            </div>
            <ReferenceChart id={id} height={260} report={report} />
          </div>
        ))}
      </section>
      <section className="card fade-in d2 overflow-hidden">
        <div className={styles.heading}>
          <div>
            <h2 className="text-[14px] font-bold tracking-tight">搜索引擎与 AI 搜索明细</h2>
            <p className="text-[11.5px] text-faint mt-0.5">会话首次来源 · 同一平台合并统计</p>
          </div>
          <button type="button" className="chip" onClick={() => actions.onAction('导出搜索引擎表')}>
            导出明细
          </button>
        </div>
        <div className={styles.filters} role="group" aria-label="搜索类型筛选">
          {['全部', '传统搜索', 'AI 搜索引荐'].map(label => (
            <button
              key={label}
              type="button"
              className="chip"
              aria-pressed={(actions.filter || '全部') === label}
              onClick={() => actions.onFilter(label)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={styles.table}>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[11.5px] text-faint border-b border-line bg-[#FAFBFD]">
                {columns.searchEngineBody.map(([, label, numeric], index) => (
                  <SortHeading
                    key={label}
                    label={label}
                    className={`font-medium px-4 py-3 ${numeric ? 'text-right' : ''} ${index === 0 ? 'pl-6' : ''}`}
                  />
                ))}
              </tr>
            </thead>
            <ReportRows table="searchEngineBody" report={report} pageSize={20} />
          </table>
        </div>
        <p className={styles.note}>
          搜索总占比按传统搜索与 AI 搜索引荐的全部会话计算；同类占比按所在搜索类型计算。
          类型筛选仅影响明细。已配置目标时统计转化率。
        </p>
      </section>
      <section className="rounded-xl bg-wash p-4 fade-in d3">
        <p className="text-[12px] text-sub leading-relaxed">
          搜索来源沿用来源渠道的识别规则：优先按入口 UTM 来源与媒介归类，其次使用会话首个来源域名。
          AI 搜索引荐统计从 AI 平台点击进入网站的会话；AI 爬虫请求在抓取分析中统计。
          来源未提供时归入直接访问，来源关键词缺失的搜索会话仍计入本页。
        </p>
      </section>
    </main>
  );
}
