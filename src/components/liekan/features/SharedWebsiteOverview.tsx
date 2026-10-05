'use client';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import type { SharedReport } from '@/lib/liekan/contracts/shared-report';
import styles from '@/styles/liekan/SharedReport.module.css';
import { LoadingLines } from '../DataLoading';
import { InsightRows, ReferenceChart } from '../ReportComponents';
import { formatCellValue, formatMetricValue, formatPercentage, stateLabels } from '../data';
import { Metrics, Notice, QueryState, Table } from './ui';

function ReportChart({
  id,
  title,
  subtitle,
  report,
  height = 260,
}: {
  id: string;
  title: string;
  subtitle: string;
  report?: SharedReport;
  height?: number;
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <ReferenceChart id={id} height={height} report={report} />
    </section>
  );
}

export function SharedWebsiteOverview({
  id,
  token,
  range,
  request,
}: {
  id: string;
  token: string;
  range: { startAt: number; endAt: number; timezone: string };
  request: (path: string, params?: any, signal?: AbortSignal) => Promise<any>;
}) {
  const chartPeriod =
    range.endAt - range.startAt <= 86400000
      ? '24h'
      : range.endAt - range.startAt <= 7 * 86400000
        ? '7d'
        : '30d';
  const query = useQuery<SharedReport>({
    queryKey: ['liekan-shared-report', token, id, range, chartPeriod],
    queryFn: ({ signal }) =>
      request(
        `/liekan/websites/${id}/shared-report`,
        {
          startAt: range.startAt,
          endAt: range.endAt,
          timezone: range.timezone,
          chartPeriod,
        },
        signal,
      ),
    retry: false,
    refetchInterval: 30000,
  });
  const report = query.data;
  const date = (time: number) => formatInTimeZone(time, range.timezone, 'MM/dd');
  const period = `${date(range.startAt)} – ${date(range.endAt)}`;
  const trendPeriod =
    range.endAt - range.startAt > 30 * 86400000 ? '截至结束日期的近 30 天' : period;
  const metrics = (labels: string[]): [string, ReactNode, ReactNode?, string?][] =>
    labels.map(label => {
      const card = report?.cards.find(card => card.label === label);
      return [
        label,
        formatMetricValue(card || { label, value: null }),
        `${card?.detail || stateLabels[card?.state || 'not_connected']}${card?.state === 'estimated' ? ' · 估算' : ''}`,
        ['跳出率', '平均访问时长'].includes(label) ? 'green' : 'blue',
      ];
    });
  const environment = (category: string) =>
    (report?.tables.envGrid || []).filter(row => row.category === category).slice(0, 5);
  const goals = report?.capabilities.goals;
  return (
    <QueryState readOnly query={query}>
      <article className={styles.report}>
        <header className={styles.reportHead}>
          <div>
            <h1>{report?.website.name || '网站流量报告'}</h1>
            <p>
              {report?.website.domain} · {period} · {range.timezone}
            </p>
          </div>
          <nav aria-label="报告章节" className={styles.chapters}>
            <a href="#shared-visitors">访客概览</a>
            <a href="#shared-ai">AI 与来源</a>
            <a href="#shared-geography">地域分布</a>
          </nav>
        </header>
        {report?.meta.demo && <Notice>当前网站为演示站，以下为隔离的示例数据。</Notice>}
        <section
          id="shared-visitors"
          className={styles.section}
          aria-labelledby="shared-visitors-title"
        >
          <h2 id="shared-visitors-title" className={styles.sectionTitle}>
            访客概览
          </h2>
          <Metrics
            className="five"
            items={metrics(['访客数 UV', '浏览量 PV', '跳出率', '平均访问时长', '新访客占比'])}
          />
          <ReportChart
            id="h1"
            title="访客趋势（UV / PV / 跳出率）"
            subtitle={`${trendPeriod} · 浏览器追踪数据`}
            report={report}
            height={300}
          />
          <div className={styles.threeColumns}>
            <ReportChart
              id="h2"
              title="访问时段热力"
              subtitle={`${period} · 24h · ${range.timezone}`}
              report={report}
            />
            <ReportChart id="h3" title="设备构成" subtitle={`${period} · 按会话`} report={report} />
            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <h2>浏览器 / OS TOP5</h2>
                <p>{period} · 按会话</p>
              </div>
              <div className={styles.environment}>
                {(['browser', 'os'] as const).map(category => (
                  <div key={category}>
                    <h3>{category === 'browser' ? '浏览器' : '操作系统'}</h3>
                    {query.isPending ? (
                      <LoadingLines />
                    ) : (
                      environment(category).map(row => (
                        <p key={String(row.name)}>
                          <span>{row.name}</span>
                          <span className="num">{formatPercentage(row.share)}</span>
                        </p>
                      ))
                    )}
                    {!query.isPending && !environment(category).length && (
                      <p className="muted">{stateLabels[report?.states.human || 'empty']}</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>
        </section>
        <section id="shared-ai" className={styles.section} aria-labelledby="shared-ai-title">
          <h2 id="shared-ai-title" className={styles.sectionTitle}>
            AI 与来源
          </h2>
          <ReportChart
            id="d1"
            title="AI 蜘蛛 vs 人类访问趋势"
            subtitle={`${trendPeriod} · 浏览器 PV / 日志 AI 请求`}
            report={report}
            height={300}
          />
          <div className={styles.threeColumns}>
            <ReportChart
              id="d2"
              title="AI 蜘蛛构成"
              subtitle={`${period} · 按请求量`}
              report={report}
            />
            <ReportChart
              id="d3"
              title="人类来源渠道"
              subtitle={`${period} · 按会话`}
              report={report}
            />
            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <h2>GEO 关键发现</h2>
                <p>{period} · 数据依据与覆盖情况</p>
              </div>
              <InsightRows className={styles.insights} report={report} />
            </section>
          </div>
        </section>
        <section
          id="shared-geography"
          className={styles.section}
          aria-labelledby="shared-geography-title"
        >
          <h2 id="shared-geography-title" className={styles.sectionTitle}>
            地域分布
          </h2>
          <Metrics items={metrics(['覆盖省份', '海外国家/地区', 'TOP1 城市', '海外 TOP1'])} />
          <div className={styles.geography}>
            <ReportChart
              id="g1"
              title="国内省份分布 TOP10"
              subtitle={`${period} · 按会话数${goals ? '（含转化率）' : ''}`}
              report={report}
              height={320}
            />
            <ReportChart
              id="g2"
              title="海外国家/地区 TOP8"
              subtitle={`${period} · 按会话数`}
              report={report}
              height={320}
            />
          </div>
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <h2>城市明细 TOP12</h2>
              <p>本地 GeoIP · 地理信息取决于识别库覆盖 · 时长按浏览间隔估算</p>
            </div>
            <Table
              columns={['城市', '会话', '占比', '平均时长', '跳出率', ...(goals ? ['转化率'] : [])]}
              numeric={[1, 2, 3, 4, 5]}
              rows={(report?.tables.cityBody || []).map(row =>
                [
                  'city',
                  'sessions',
                  'share',
                  'duration',
                  'bounceRate',
                  ...(goals ? ['conversionRate'] : []),
                ].map(field => formatCellValue(row, field, 'cityBody')),
              )}
            />
          </section>
        </section>
      </article>
    </QueryState>
  );
}
