'use client';
import { useEffect, useState } from 'react';
import {
  keywordConditionsSchema,
  keywordEngines,
  keywordEvidenceLabels,
  keywordStatuses,
  keywordStatusLabels,
  type KeywordConditions,
} from '@/lib/liekan/contracts/keywords';
import { MetricCard } from '../ReportComponents';
import { useReportActions } from '../ReportContext';
import { KeywordExport } from '../KeywordExport';
import { formatPercentage, formatValue } from '../data';
import { useDataLoading, Skeleton } from '../DataLoading';
import type { ReportViewProps } from '../types';

const headings = [
  ['keyword', '关键词 / 状态'],
  ['engine', '搜索引擎'],
  ['evidence', '识别依据'],
  ['sessions', '会话数'],
  ['share', '搜索渠道占比'],
  ['bounceRate', '跳出率'],
  ['conversionRate', '转化率'],
] as const;
const control = 'chip text-[12px] focus-visible:outline-2 focus-visible:outline-brand';
export function HumanKeywords({ report, rangeLabel }: ReportViewProps) {
  const loading = useDataLoading();
  const { keywords } = useReportActions();
  const conditions = keywords?.conditions || keywordConditionsSchema.parse({});
  const busy = loading || !report || keywords?.busy;
  const [search, setSearch] = useState(conditions.search);
  useEffect(() => setSearch(conditions.search), [conditions.search]);
  const change = (next: Partial<KeywordConditions>) => keywords?.onChange(next);
  const pagination = report?.meta.tablePages?.keywordBody;
  const total = pagination?.total || 0;
  const page = pagination?.page || 1;
  const count = Math.max(1, Math.ceil(total / 20));
  return (
    <main className="max-w-[1200px] mx-auto px-8 py-6 space-y-4">
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {['搜索渠道会话', '来源搜索词会话', 'UTM 关键词会话', '关键词可用率'].map(label => (
          <MetricCard
            key={label}
            label={label}
            className="card p-4"
            valueClass="num text-[24px] font-bold text-brand mt-1.5"
            report={report}
          />
        ))}
      </section>
      <section className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-line keyword-detail-header">
          <div className="flex items-center justify-between gap-3 keyword-heading">
            <div>
              <h2 className="text-[14px] font-bold tracking-tight">来源关键词明细</h2>
              <p className="text-[11.5px] text-faint mt-0.5">
                {rangeLabel} · 会话首次来源 · 每次会话计入一行
              </p>
            </div>
            <KeywordExport report={report} conditions={conditions} disabled={Boolean(busy)} />
          </div>
          <div className="flex flex-wrap gap-3 keyword-controls">
            <label className="text-[11.5px] text-sub">
              搜索引擎
              <select
                className={`${control} block mt-1`}
                aria-label="搜索引擎"
                value={conditions.engine}
                disabled={busy}
                onChange={e => change({ engine: e.target.value as KeywordConditions['engine'] })}
              >
                <option value="">全部搜索引擎</option>
                {keywordEngines.map(engine => (
                  <option key={engine}>{engine}</option>
                ))}
              </select>
            </label>
            <label className="text-[11.5px] text-sub">
              识别依据
              <select
                className={`${control} block mt-1`}
                aria-label="识别依据"
                value={conditions.evidence}
                disabled={busy}
                onChange={e =>
                  change({ evidence: e.target.value as KeywordConditions['evidence'] })
                }
              >
                <option value="">全部依据</option>
                {Object.entries(keywordEvidenceLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11.5px] text-sub">
              关键词状态
              <select
                className={`${control} block mt-1`}
                aria-label="关键词状态"
                value={conditions.status}
                disabled={busy}
                onChange={e => change({ status: e.target.value as KeywordConditions['status'] })}
              >
                <option value="">全部状态</option>
                {keywordStatuses.map(status => (
                  <option key={status} value={status}>
                    {keywordStatusLabels[status]}
                  </option>
                ))}
              </select>
            </label>
            <form
              className="keyword-query"
              onSubmit={e => {
                e.preventDefault();
                change({ search });
              }}
            >
              <label className="text-[11.5px] text-sub">
                关键词查询
                <input
                  className={`${control} block mt-1 keyword-search`}
                  aria-label="关键词查询"
                  maxLength={200}
                  placeholder="输入关键词或状态"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </label>
              <button type="submit" disabled={busy} className={control}>
                查询
              </button>
            </form>
            <button
              type="button"
              disabled={busy}
              className="text-[12px] text-brand pb-2"
              onClick={() => {
                setSearch('');
                change(keywordConditionsSchema.parse({}));
              }}
            >
              重置筛选
            </button>
          </div>
          <p className="text-[11.5px] text-faint">
            指标卡与占比按所选搜索引擎统计；关键词、依据和状态筛选仅影响明细。
          </p>
        </div>
        <div className="overflow-x-auto" aria-busy={busy}>
          <table className="w-full text-[12.5px] keyword-table">
            <thead>
              <tr className="text-left text-[11.5px] text-faint border-b border-line bg-[#FAFBFD]">
                {headings.map(([key, label], index) => (
                  <th
                    key={key}
                    scope="col"
                    aria-sort={
                      conditions.sort === key
                        ? conditions.direction === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                    className={`font-medium px-4 py-3 ${index === 0 ? 'pl-6' : ''} ${index > 2 ? 'text-right' : ''}`}
                  >
                    <button
                      type="button"
                      disabled={busy}
                      className="focus-visible:outline-2 focus-visible:outline-brand"
                      onClick={() =>
                        change({
                          sort: key,
                          direction:
                            conditions.sort === key && conditions.direction === 'desc'
                              ? 'asc'
                              : 'desc',
                        })
                      }
                    >
                      {label}
                      {conditions.sort === key
                        ? conditions.direction === 'asc'
                          ? ' ↑'
                          : ' ↓'
                        : ''}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }, (_, i) => (
                  <tr key={i}>
                    <td colSpan={7} className="px-6 py-4">
                      <Skeleton width="80%" />
                    </td>
                  </tr>
                ))
              ) : report?.tables.keywordBody?.length ? (
                report.tables.keywordBody.map(row => (
                  <tr key={String(row.id)} className="border-b border-line">
                    <td className="pl-6 pr-4 py-3 keyword-term">
                      {row.keyword ||
                        keywordStatusLabels[row.status as keyof typeof keywordStatusLabels]}
                    </td>
                    <td className="px-4 py-3">{row.engine}</td>
                    <td className="px-4 py-3 text-sub">
                      {keywordEvidenceLabels[row.evidence as keyof typeof keywordEvidenceLabels]}
                    </td>
                    <td className="px-4 py-3 text-right keyword-number">
                      {formatValue(row.sessions)}
                    </td>
                    <td className="px-4 py-3 text-right keyword-number">
                      {formatPercentage(row.share)}
                    </td>
                    <td className="px-4 py-3 text-right keyword-number">
                      {formatPercentage(row.bounceRate)}
                    </td>
                    <td className="px-4 py-3 text-right keyword-number">
                      {formatPercentage(row.conversionRate)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-faint">
                    {report?.cards[0]?.value ? '当前筛选暂无匹配结果' : '当前范围暂无搜索渠道会话'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-3 flex items-center justify-between gap-3 keyword-heading text-[11.5px] text-sub">
          <span>
            共 {formatValue(total)} 行 · 第 {page} / {count} 页 · 每页 20 行
          </span>
          <div className="flex gap-3">
            <button
              type="button"
              className={control}
              disabled={busy || page <= 1}
              onClick={() => keywords?.onPage(page - 1)}
            >
              上一页
            </button>
            <button
              type="button"
              className={control}
              disabled={busy || page >= count}
              onClick={() => keywords?.onPage(page + 1)}
            >
              下一页
            </button>
          </div>
        </div>
      </section>
      <section className="rounded-xl bg-wash p-4 text-[12px] text-sub leading-relaxed space-y-1">
        <p>
          来源未携带搜索词表示搜索词参数缺失或为空；跳转链接无可用搜索词表示来源为已识别的跳转链接，且没有非空的搜索词参数。
          这些会话仍计入搜索流量，现有记录中缺失的搜索词无法恢复。
        </p>
        <p>
          来源搜索词优先识别；UTM 关键词为手动标记，可通过推广链接的 utm_term 参数提供。
          来源格式不支持、完整性无法确认、解析失败和脱敏状态分别显示。
          {report?.meta.keywordHasGoals === false ? '尚未配置转化目标，转化率显示为空。' : ''}
        </p>
        <p>完整导出会读取新的统计快照；文件注明读取时间和筛选条件。</p>
      </section>
    </main>
  );
}
