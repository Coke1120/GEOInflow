'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { duration, percentage } from '@/lib/liekan/contracts/analysis';
import { numberLabel, rowsOf } from '@/lib/liekan/contracts/features';
import {
  formatRevenueAmount,
  formatRevenueAverage,
  sumRevenueAmounts,
} from '@/lib/liekan/contracts/revenue';
import { Chart } from './Chart';
import { useAction, useData, useFeature } from './context';
import 'rrweb-player/dist/style.css';
import { Exports } from './Exports';
import {
  Badge,
  Body,
  Button,
  Definition,
  LiekanDialog,
  DialogActions,
  Field,
  Form,
  Icon,
  LinkButton,
  Metrics,
  Notice,
  Panel,
  QueryState,
  Select,
  Table,
  Tabs,
} from './ui';

export const extendedPages = new Set([
  'performance',
  'revenue',
  'heatmaps',
  'replays',
  'replay-player',
  'exports',
  'access-denied',
  'session-expired',
  'not-found',
]);
const n = numberLabel;
function useScope(extra: any = {}) {
  const c = useFeature();
  return { ...c.range, ...c.filters, ...extra };
}
function useWebsiteQuery(key: any[], path: string, params: any = {}, enabled = true, own = false) {
  const c = useFeature();
  return useData(
    key,
    signal => c.api.get(`${own ? '/liekan' : ''}/websites/${c.siteId}/${path}`, params, signal),
    !!c.siteId && enabled,
    ['revenue', 'replays'].includes(params.kind) || path.startsWith('replays/')
      ? {
          queryKey: ['liekan-feature', c.user.id, c.siteId, ...key, params],
          staleTime: 0,
          direct: true,
        }
      : undefined,
  );
}
const masked = (id: string) => `访客 ${id?.replaceAll('-', '').slice(-6) || '—'}`;
const missingReplaySnapshotMessage = '此录制缺少完整页面快照，暂时无法播放。';
const perfValue = (value: number | null, metric: string) =>
  value == null
    ? '未采集'
    : metric === 'cls'
      ? Number(value).toFixed(3)
      : value >= 1000
        ? `${(value / 1000).toFixed(2)} s`
        : `${Math.round(value)} ms`;
function Performance() {
  const [metric, setMetric] = useState('lcp'),
    [percentile, setPercentile] = useState('p75'),
    [environment, setEnvironment] = useState('device');
  const scope = useScope({ metric });
  const counts = useWebsiteQuery(
    ['performance-real-counts'],
    'analytics',
    { ...scope, kind: 'performance' },
    true,
    true,
  );
  const summary = useWebsiteQuery(['performance-summary'], 'performance/stats', scope);
  const chart = useWebsiteQuery(['performance-chart', metric], 'performance/chart', scope);
  const pages = useWebsiteQuery(['performance-pages', metric], 'performance/metrics', {
    ...scope,
    type: 'path',
    limit: 100,
  });
  const devices = useWebsiteQuery(['performance-env', metric, environment], 'performance/metrics', {
    ...scope,
    type: environment,
    limit: 100,
  });
  const data = counts.data,
    points = chart.data?.chart || [];
  const value = (m: string) =>
    data
      ? data[`${m}${percentile.charAt(0).toUpperCase() + percentile.slice(1)}`]
      : summary.data?.count
        ? summary.data?.[m]?.[percentile]
        : null;
  return (
    <>
      <div className="row between">
        <Tabs
          items={['lcp', 'inp', 'cls', 'fcp', 'ttfb'].map(m => [m, m.toUpperCase()])}
          active={metric}
          onChange={setMetric}
        />
        <Select
          label="摘要分位数"
          value={percentile}
          onChange={e => setPercentile(e.target.value)}
          options={[
            ['p50', 'p50 · 中位数'],
            ['p75', 'p75 · 第 75 分位'],
            ['p95', 'p95 · 第 95 分位'],
          ]}
        />
      </div>
      <Metrics
        loading={summary.isPending}
        className="five"
        items={['lcp', 'inp', 'cls', 'fcp', 'ttfb'].map(
          (m, i) =>
            [
              m.toUpperCase(),
              perfValue(value(m), m),
              `${['最大内容绘制', '交互延迟', '累计布局偏移', '首次内容绘制', '首字节时间'][i]} · ${percentile}`,
              m === metric ? 'blue' : '',
            ] as any,
        )}
      />
      <Panel
        title={`${metric.toUpperCase()} 分位数趋势`}
        subtitle={`p50、p75、p95 · ${data ? n(data[`${metric}Count`]) : summary.data ? n(summary.data.count) : '—'} 次采样`}
      >
        <QueryState query={chart}>
          <Chart
            labels={points.map((r: any) => r.t)}
            series={['p50', 'p75', 'p95'].map(p => ({
              name: p,
              values: points.map((r: any) => (r[p] == null ? null : Number(r[p]))),
            }))}
            option={{
              yAxis: {
                type: 'value',
                axisLabel: {
                  formatter: (v: number) => (metric === 'cls' ? v : perfValue(v, metric)),
                },
                splitLine: { lineStyle: { color: '#E9ECF1' } },
              },
            }}
          />
        </QueryState>
      </Panel>
      <div className="two">
        <Panel title="页面性能" subtitle="所选指标和分位数，保留单位。">
          <QueryState query={pages}>
            <Table
              columns={['页面', `${metric.toUpperCase()} · ${percentile}`, '采样数']}
              rows={(pages.data || []).map((r: any) => [
                r.name || '未提供',
                perfValue(r[percentile] == null ? null : Number(r[percentile]), metric),
                n(r.count),
              ])}
              numeric={[1, 2]}
            />
          </QueryState>
        </Panel>
        <Panel
          title="环境拆分"
          subtitle="设备与浏览器分别查看。"
          actions={
            <Tabs
              items={[
                ['device', '设备'],
                ['browser', '浏览器'],
              ]}
              active={environment}
              onChange={setEnvironment}
            />
          }
        >
          <QueryState query={devices}>
            <Table
              columns={[
                environment === 'device' ? '设备' : '浏览器',
                `${metric.toUpperCase()} · ${percentile}`,
                '采样数',
              ]}
              rows={(devices.data || []).map((r: any) => [
                r.name || '未提供',
                perfValue(r[percentile] == null ? null : Number(r[percentile]), metric),
                n(r.count),
              ])}
              numeric={[1, 2]}
            />
          </QueryState>
        </Panel>
      </div>
      <Notice>性能数据需采集对应浏览器指标。没有样本时显示“未采集”。CLS 不使用时间单位。</Notice>
      {counts.error && <QueryState query={counts}>{null}</QueryState>}
      {summary.error && <QueryState query={summary}>{null}</QueryState>}
    </>
  );
}
function Revenue() {
  const c = useFeature();
  const [currency, setCurrency] = useState('CNY'),
    [mode, setMode] = useState('period'),
    [page, setPage] = useState(1);
  const scope = useScope({ currency });
  useEffect(() => setPage(1), [JSON.stringify(scope)]);
  const summary = useWebsiteQuery(['revenue-summary', currency], 'revenue/stats', scope);
  const chart = useWebsiteQuery(['revenue-chart', currency], 'revenue/chart', scope);
  const sources = useWebsiteQuery(['revenue-sources', currency], 'revenue/metrics', {
    ...scope,
    type: 'referrer',
  });
  const transactions = useWebsiteQuery(
    ['revenue-transactions', currency, page],
    'analytics',
    { ...scope, kind: 'revenue', page },
    true,
    true,
  );
  const totals = summary.data;
  const points = chart.data?.chart || [];
  const labels = [...new Set<string>(points.map((r: any) => r.t))];
  let running = '0';
  const exactSeries = labels.map(t => {
    const value = sumRevenueAmounts(points.filter((r: any) => r.t === t).map((r: any) => r.y));
    running = sumRevenueAmounts([running, value]);
    return mode === 'period' ? value : running;
  });
  const series = exactSeries.map(Number);
  const money = (value: unknown) => formatRevenueAmount(value, currency);
  return (
    <>
      <div className="row between">
        <Select
          label="币种"
          value={currency}
          options={['CNY', 'USD']}
          onChange={e => {
            setCurrency(e.target.value);
            setPage(1);
          }}
        />
        <Tabs
          items={[
            ['period', '按期间'],
            ['cumulative', '累计'],
          ]}
          active={mode}
          onChange={setMode}
        />
      </div>
      <Metrics
        loading={summary.isPending}
        items={[
          ['收入', totals ? money(totals.sum) : null, `${currency} · 所选币种`],
          ['付费事件', totals ? n(totals.count) : null, '收入事件触发次数'],
          ['付费访客', totals ? n(totals.unique_count) : null, '独立访客'],
          [
            '平均事件金额',
            totals ? formatRevenueAverage(totals.sum, Number(totals.count), currency) : '—',
            '收入 / 付费事件',
          ],
        ]}
      />
      {summary.error && <QueryState query={summary}>{null}</QueryState>}
      <Panel title="收入趋势" subtitle={`金额单位：${currency}。累计从所选期间起点计算。`}>
        <QueryState query={chart}>
          <Chart
            labels={labels}
            series={[{ name: currency, values: series }]}
            option={{
              tooltip: {
                valueFormatter: (_value: unknown, index: number) => money(exactSeries[index]),
              },
              series: [
                {
                  data: exactSeries.map(amount => ({ value: Number(amount), exactAmount: amount })),
                },
              ],
            }}
          />
        </QueryState>
      </Panel>
      <div className="two">
        <Panel title="收入来源" subtitle={`当前币种 ${currency} 的收入贡献。`}>
          <QueryState query={sources}>
            <Table
              columns={['来源', '收入', '占比']}
              rows={(sources.data || []).map((r: any) => [
                r.name || '直接访问',
                money(r.value),
                percentage(Number(r.value), Number(totals?.sum)),
              ])}
              numeric={[1, 2]}
            />
          </QueryState>
        </Panel>
        <Panel title="交易访问记录" subtitle={`事件金额与币种属性，金额单位：${currency}。`}>
          <QueryState query={transactions}>
            <Table
              columns={['会话', '事件', '金额', '操作']}
              rows={(transactions.data?.rows || []).map((r: any) => [
                masked(r.sessionId),
                r.event,
                money(r.amount),
                <Link
                  prefetch={false}
                  key={r.id}
                  href={c.href('session-detail', { id: r.sessionId })}
                >
                  查看访问详情 →
                </Link>,
              ])}
              numeric={[2]}
              page={page}
              pages={Math.ceil((transactions.data?.count || 0) / 25)}
              onPage={setPage}
            />
          </QueryState>
        </Panel>
      </div>
      <Notice>
        不同币种分别展示，使用已采集的事件金额，保持上游事件去重口径。当前页面不进行汇率换算。
      </Notice>
    </>
  );
}
function Heatmaps() {
  const c = useFeature();
  const [path, setPath] = useState(''),
    [device, setDevice] = useState('desktop'),
    [mode, setMode] = useState('click');
  const scope = useScope({
    urlPath: path,
    mode,
    device: `eq.${device === 'phone' ? 'mobile' : device}`,
  });
  const query = useWebsiteQuery(['heatmap', path, device, mode], 'heatmaps', scope);
  const exactScroll = useWebsiteQuery(
    ['exact-scroll', path, device],
    'analytics',
    { ...scope, kind: 'heatmap-scroll' },
    mode === 'scroll' && !!path,
    true,
  );
  const recorder = useWebsiteQuery(['heatmap-recorder'], 'recorder');
  const d = query.data,
    pages = d?.pages || [],
    selected = pages.find((p: any) => p.urlPath === path),
    snapshot = d?.snapshot;
  const scroll = d?.scroll;
  const points = d?.points || [];
  const clicks = points.reduce((s: number, p: any) => s + Number(p.count), 0);
  const reached = (depth: number) => exactScroll.data?.[`reach${depth}`];
  const maxCount = Math.max(1, ...points.map((p: any) => Number(p.count)));
  const stage = useRef<HTMLDivElement>(null),
    [width, setWidth] = useState(0);
  useEffect(() => {
    if (!stage.current) return;
    const observer = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, [snapshot?.id]);
  useEffect(() => {
    if (!path && pages[0]) setPath(pages[0].urlPath);
  }, [JSON.stringify(pages)]);
  const scale = snapshot && width ? width / Math.max(snapshot.pageW, snapshot.viewportW) : 1;
  const height = snapshot ? Math.max(300, snapshot.pageH * scale) : 420;
  return (
    <>
      <Notice tone="amber">
        画布使用当前页面预览叠加真实聚合数据。页面布局变化或网站禁止嵌入时，可通过右侧明细核对采样结果。
      </Notice>
      <div className="row between">
        <div className="row">
          <Select
            label="页面"
            options={pages.map((p: any) => p.urlPath)}
            value={path}
            onChange={e => setPath(e.target.value)}
          />
          <Select
            label="设备"
            options={[
              ['desktop', '桌面'],
              ['phone', '移动'],
            ]}
            value={device}
            onChange={e => setDevice(e.target.value)}
          />
        </div>
        <Tabs
          items={[
            ['click', '点击热力图'],
            ['scroll', '滚动热力图'],
          ]}
          active={mode}
          onChange={setMode}
        />
      </div>
      <Metrics
        loading={
          mode === 'click'
            ? [query.isPending, query.isPending, query.isPending, recorder.isPending]
            : !!path && exactScroll.isPending
        }
        items={
          mode === 'click'
            ? [
                [
                  '采样会话',
                  selected ? n(selected.sessions) : query.data ? '0' : null,
                  '当前页面与设备',
                ],
                ['点击次数', query.data ? n(clicks) : null, '当前页聚合点击'],
                ['主要点击', points.length ? '见坐标明细' : '未采集', '由实际点击坐标聚合'],
                [
                  '采样率',
                  recorder.data
                    ? recorder.data.heatmapSampleRate == null
                      ? '未开启'
                      : `${Number(recorder.data.heatmapSampleRate) * 100}%`
                    : null,
                  '行为采集配置',
                ],
              ]
            : [
                ['采样会话', n(exactScroll.data?.total), '当前页面与设备'],
                [
                  '到达 50%',
                  percentage(reached(50), exactScroll.data?.total),
                  `${n(reached(50))} / ${n(exactScroll.data?.total)}`,
                ],
                [
                  '到达 75%',
                  percentage(reached(75), exactScroll.data?.total),
                  `${n(reached(75))} / ${n(exactScroll.data?.total)}`,
                ],
                [
                  '到达底部',
                  percentage(reached(100), exactScroll.data?.total),
                  `${n(reached(100))} / ${n(exactScroll.data?.total)}`,
                ],
              ]
        }
      />
      {exactScroll.error && mode === 'scroll' && (
        <QueryState query={exactScroll}>{null}</QueryState>
      )}
      <div className="wide-narrow">
        <Panel
          title={mode === 'click' ? '点击分布' : '滚动深度'}
          subtitle="热度表达聚合强度，右侧同时提供数值。"
        >
          <Body>
            <QueryState query={query}>
              <div
                className="browser-stage"
                ref={stage}
                style={{ maxHeight: 720, overflow: 'auto' }}
              >
                <div className="browser-bar">{snapshot?.url || path || '选择已采集页面'}</div>
                {snapshot ? (
                  <div style={{ position: 'relative', height, overflow: 'hidden' }}>
                    <iframe
                      title="采集页面预览"
                      src={snapshot.url}
                      referrerPolicy="no-referrer"
                      sandbox="allow-scripts allow-forms"
                      style={{
                        border: 0,
                        width: Math.max(snapshot.pageW, snapshot.viewportW),
                        height: snapshot.pageH,
                        transform: `scale(${scale})`,
                        transformOrigin: '0 0',
                        pointerEvents: 'none',
                      }}
                    />
                    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                      {mode === 'click'
                        ? points.map((p: any, i: number) => (
                            <span
                              key={i}
                              className="hot-spot"
                              style={{
                                position: 'absolute',
                                left: `${(p.pageX / p.pageW) * 100}%`,
                                top: `${(p.pageY / p.pageH) * 100}%`,
                                width: 24 + (Number(p.count) / maxCount) * 72,
                                height: 24 + (Number(p.count) / maxCount) * 72,
                                transform: 'translate(-50%,-50%)',
                                opacity: 0.4 + (Number(p.count) / maxCount) * 0.5,
                              }}
                            />
                          ))
                        : (scroll?.buckets || []).map((b: any, i: number) => (
                            <div
                              key={i}
                              style={{
                                position: 'absolute',
                                left: 0,
                                right: 0,
                                top: `${b.depth}%`,
                                height: '10%',
                                background: `rgba(15,98,254,${Math.min(0.6, Number(b.sessions) / Math.max(1, scroll.totalSessions))})`,
                              }}
                            />
                          ))}
                    </div>
                  </div>
                ) : (
                  <div className="state-box">
                    <h3>尚未采集可预览的数据</h3>
                    <p>开启行为采集并产生对应页面的点击或滚动后，此处显示真实分布。</p>
                    <LinkButton page="recorder-settings" params={{ websiteId: c.siteId }}>
                      查看当前网站采集设置
                    </LinkButton>
                  </div>
                )}
              </div>
            </QueryState>
          </Body>
        </Panel>
        <Panel title="页面明细" subtitle="当前日期与设备的采样区间。">
          <Body>
            <Definition
              items={[
                ['页面', path || '未选择'],
                ['设备', device === 'phone' ? '移动' : '桌面'],
                ['采集范围', '聚合行为坐标'],
                ['热度颜色', '蓝：低；橙：中；红：高'],
              ]}
            />
            <hr className="divider" />
            <QueryState query={query}>
              <Table
                columns={mode === 'click' ? ['区域', '点击'] : ['深度', '到达会话']}
                rows={
                  mode === 'click'
                    ? points.map((p: any) => [
                        `(${Math.round(p.pageX)}, ${Math.round(p.pageY)})`,
                        n(p.count),
                      ])
                    : [25, 50, 75, 100].map(depth => [`${depth}%`, n(reached(depth))])
                }
                numeric={[1]}
              />
            </QueryState>
            <div className="form-actions">
              <LinkButton page="recorder-settings" params={{ websiteId: c.siteId }}>
                网站采集设置
              </LinkButton>
            </div>
          </Body>
        </Panel>
      </div>
      {recorder.error && <QueryState query={recorder}>{null}</QueryState>}
    </>
  );
}
function Replays() {
  const c = useFeature();
  const [tab, setTab] = useState('all'),
    [page, setPage] = useState(1);
  const query = useWebsiteQuery(
    ['replay-list', tab, page],
    'analytics',
    { ...useScope(), kind: 'replays', saved: tab === 'saved' ? '1' : '0', page },
    true,
    true,
  );
  const rows: any[] = query.data?.rows || [];
  useEffect(
    () => setPage(1),
    [c.siteId, c.range.startAt, c.range.endAt, JSON.stringify(c.filters)],
  );
  return (
    <>
      <Tabs
        items={[
          ['all', '所有录制'],
          ['saved', '已保存'],
        ]}
        active={tab}
        onChange={t => {
          setTab(t);
          setPage(1);
        }}
      />
      <Panel
        title="会话录制"
        subtitle="隐私遮蔽后的实际录制，通过录制标识进入播放器。"
        actions={
          <LinkButton page="recorder-settings" params={{ websiteId: c.siteId }}>
            网站采集设置
          </LinkButton>
        }
      >
        <QueryState query={query}>
          <Table
            search
            columns={['录制', '来源', '设备', '时长', '页面数', '状态', '操作']}
            rows={rows.map(r => [
              r.name ||
                `${masked(r.sessionId)} · ${r.startedAt ? new Date(r.startedAt).toLocaleTimeString('zh-CN') : '已保存录制'}`,
              r.referrerDomain || '未提供',
              r.device || '未提供',
              duration(r.duration == null ? null : Number(r.duration) / 1000),
              r.pageviews == null ? '未提供' : n(r.pageviews),
              <Badge key={r.id} tone={tab === 'saved' ? 'blue' : 'green'}>
                {tab === 'saved' ? '已保存' : '可播放'}
              </Badge>,
              <Link
                prefetch={false}
                href={c.href('replay-player', { id: tab === 'saved' ? r.visitId : r.id })}
                key={r.id}
              >
                播放 →
              </Link>,
            ])}
            numeric={[3, 4]}
            page={page}
            pages={Math.ceil((query.data?.count || 0) / 25)}
            onPage={setPage}
          />
          {!rows.length && (
            <Notice>
              当前日期与筛选条件下没有录制。会话是一次连续访问，录制需要提前开启行为采集。
              <LinkButton page="recorder-settings" params={{ websiteId: c.siteId }}>
                查看当前网站采集设置
              </LinkButton>
            </Notice>
          )}
        </QueryState>
      </Panel>
      <Notice>
        采集开关、采样与存储策略从行为采集设置管理。未采集的环境与来源字段显示“未提供”。
      </Notice>
    </>
  );
}
function ReplayPlayer() {
  const c = useFeature(),
    action = useAction();
  const id = c.route.id;
  const query = useWebsiteQuery(['replay', id], `replays/${id}`, {}, !!id);
  const saved = useWebsiteQuery(['replay-saved', id], `replays/saved/${id}`, {}, !!id);
  const [saveOpen, setSaveOpen] = useState(false);
  const [playing, setPlaying] = useState(false),
    [time, setTime] = useState(0),
    [speed, setSpeed] = useState('1'),
    [error, setError] = useState('');
  const container = useRef<HTMLDivElement>(null),
    player = useRef<any>(null),
    speedRef = useRef(1);
  speedRef.current = Number(speed);
  const events = query.data?.events || [];
  const total = events.length ? (events.at(-1).timestamp - events[0].timestamp) / 1000 : 0;
  useEffect(() => {
    let canceled = false,
      observer: ResizeObserver,
      interval: ReturnType<typeof setInterval>;
    setError('');
    setPlaying(false);
    setTime(0);
    const element = container.current;
    if (!element || events.length < 2) return;
    import('rrweb-player')
      .then(async module => {
        if (canceled) return;
        const { prepareReplayEvents } = await import('@/lib/liekan/upstream/replay-client');
        if (canceled) return;
        const playable = prepareReplayEvents(events);
        if (playable.length < 2) {
          setError(missingReplaySnapshotMessage);
          return;
        }
        try {
          player.current = new module.default({
            target: element,
            props: {
              events: playable,
              width: Math.max(240, element.clientWidth),
              height: 460,
              autoPlay: false,
              showController: false,
              speed: speedRef.current,
              speedOption: [0.5, 1, 2, 4],
              useVirtualDom: false,
              showWarning: false,
            },
          });
          observer = new ResizeObserver(() =>
            player.current?.$set({ width: Math.max(240, element.clientWidth) }),
          );
          observer.observe(element);
          interval = setInterval(() => {
            const current = player.current?.getReplayer?.();
            if (current) setTime(Math.max(0, current.getCurrentTime() / 1000));
          }, 200);
          player.current.addEventListener?.('finish', () => setPlaying(false));
        } catch {
          setError('录制播放器加载失败，请重新读取。');
        }
      })
      .catch(() => setError('播放器加载失败。'));
    return () => {
      canceled = true;
      observer?.disconnect();
      clearInterval(interval);
      try {
        player.current?.$destroy?.();
      } catch {}
      player.current = null;
      element.replaceChildren();
    };
  }, [query.data]);
  useEffect(() => {
    player.current?.getReplayer?.().setConfig({ speed: Number(speed) });
  }, [speed]);
  const seek = (seconds: number) => {
    setTime(seconds);
    const replay = player.current?.getReplayer?.();
    if (playing) replay?.play(seconds * 1000);
    else replay?.pause(seconds * 1000);
  };
  const behavior = events
    .filter((e: any) => e.type === 4 || e.type === 5)
    .map((e: any) => ({
      time: Math.max(0, (e.timestamp - events[0].timestamp) / 1000),
      label: e.type === 4 ? e.data?.href : e.data?.tag || '行为标记',
    }));
  if (!id)
    return (
      <Notice>
        请选择录制后查看。<LinkButton page="replays">返回录制列表</LinkButton>
      </Notice>
    );
  return (
    <>
      <div className="row between">
        <div>
          <h2>{masked(query.data?.sessionId)} · 访问路径</h2>
          <p className="muted">
            {query.data?.startedAt
              ? new Date(query.data.startedAt).toLocaleString('zh-CN')
              : '正在读取'}{' '}
            · 实际录制
          </p>
        </div>
        <div className="actions">
          <LinkButton page="replays">返回录制列表</LinkButton>
          <Button
            disabled={
              saved.isPending ||
              !!saved.error ||
              !(
                c.user.isAdmin ||
                c.site?.userId === c.user.id ||
                c.teams.some(
                  t =>
                    t.id === c.site?.teamId &&
                    t.members?.some(
                      (m: any) =>
                        m.userId === c.user.id &&
                        ['team-owner', 'team-manager', 'team-member'].includes(m.role),
                    ),
                )
              )
            }
            onClick={() => setSaveOpen(true)}
          >
            {saved.data?.isSaved ? '已保存' : '保存会话回放'}
          </Button>
        </div>
      </div>
      <Notice tone="amber">播放器重建已经采集并遮蔽的录制事件。录制未包含的行为不会补生成。</Notice>
      <QueryState query={query}>
        <div className="wide-narrow">
          <Panel title="回放画布" subtitle="使用实际页面快照与采集视口。">
            <Body>
              {error && (
                <Notice tone="red">
                  {error}
                  {error === missingReplaySnapshotMessage && (
                    <LinkButton page="recorder-settings" params={{ websiteId: c.siteId }}>
                      查看当前网站采集设置
                    </LinkButton>
                  )}
                </Notice>
              )}
              {events.length < 2 && (
                <Notice>
                  当前录制没有可播放的完整快照。
                  <LinkButton page="recorder-settings" params={{ websiteId: c.siteId }}>
                    查看当前网站采集设置
                  </LinkButton>
                </Notice>
              )}
              <div
                ref={container}
                className="replay-stage"
                style={{ minHeight: 460, overflow: 'hidden' }}
              />
              <div className="player-controls">
                <Button
                  disabled={events.length < 2 || !!error}
                  onClick={() => {
                    const replay = player.current?.getReplayer?.();
                    if (!replay) return;
                    if (playing) replay.pause();
                    else replay.play(time * 1000);
                    setPlaying(!playing);
                  }}
                >
                  <Icon name={playing ? 'pause' : 'play'} />
                  {playing ? '暂停' : '播放'}
                </Button>
                <span className="num">
                  {duration(time)} / {duration(total)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, total)}
                  value={Math.min(time, total)}
                  step={0.1}
                  aria-label="播放位置"
                  onChange={e => seek(Number(e.target.value))}
                />
                <Select
                  label="播放速度"
                  value={speed}
                  onChange={e => setSpeed(e.target.value)}
                  options={[
                    ['.5', '0.5×'],
                    ['1', '1×'],
                    ['2', '2×'],
                    ['4', '4×'],
                  ]}
                />
              </div>
            </Body>
          </Panel>
          <Panel title="行为时间线" subtitle="点击节点定位到录制时间。">
            <Body>
              <ul className="timeline">
                {behavior.map((b: any, i: number) => (
                  <li key={i}>
                    <time className="timeline-time">{duration(b.time)}</time>
                    <button className="table-action" onClick={() => seek(b.time)}>
                      {b.label}
                    </button>
                    <p>实际录制时间点</p>
                  </li>
                ))}
              </ul>
              {!behavior.length && <Notice>此录制未提供页面或自定义行为标记。</Notice>}
              <hr className="divider" />
              {query.data?.sessionId && (
                <LinkButton page="session-detail" params={{ id: query.data.sessionId }}>
                  查看访问详情
                </LinkButton>
              )}
            </Body>
          </Panel>
        </div>
      </QueryState>
      {saveOpen && (
        <LiekanDialog
          title={saved.data?.isSaved ? '管理已保存回放' : '保存会话回放'}
          onClose={() => {
            if (!action.busy) setSaveOpen(false);
          }}
        >
          {!saved.data?.isSaved && (
            <Form
              busy={action.busy}
              error={action.error}
              submitLabel="保存回放"
              onSubmit={async v => {
                await action.run(
                  () =>
                    c.api.post(`/websites/${c.siteId}/replays/saved/${id}`, {
                      isSaved: true,
                      name: v.name,
                    }),
                  '录制已保存',
                );
                setSaveOpen(false);
              }}
            >
              <Notice>为当前会话回放添加名称，便于在已保存列表中查找。</Notice>
              <Field label="回放名称" name="name" required maxLength={100} />
            </Form>
          )}
          {saved.data?.isSaved && (
            <>
              <Notice>此会话回放已保存，可在已保存列表查看或取消保存。</Notice>
              {action.error && <Notice tone="red">{action.error}</Notice>}
              <DialogActions>
                <Button
                  danger
                  disabled={action.busy}
                  onClick={async () => {
                    await action.run(
                      () =>
                        c.api.post(`/websites/${c.siteId}/replays/saved/${id}`, { isSaved: false }),
                      '录制已取消保存',
                    );
                    setSaveOpen(false);
                  }}
                >
                  取消保存此回放
                </Button>
              </DialogActions>
            </>
          )}
        </LiekanDialog>
      )}
    </>
  );
}
export function ExtendedPages({ page }: { page: string }) {
  const c = useFeature();
  if (!extendedPages.has(page)) return null;
  if (['access-denied', 'session-expired', 'not-found'].includes(page)) {
    const states: any = {
      'access-denied': [
        '403',
        '权限不足',
        '当前身份仅能查看授权网站。此操作需要资源管理员权限。',
        '返回工作台',
        'websites',
      ],
      'session-expired': [
        '登录已过期',
        '重新登录',
        '完成登录后继续使用。未保存的编辑需要重新确认。',
        '重新登录',
        'login',
      ],
      'not-found': [
        '404',
        '页面不存在',
        '页面可能已经移动，或当前地址无效。可返回工作台选择需要的功能。',
        '返回工作台',
        'websites',
      ],
    };
    const state = states[page];
    return (
      <div className="state-box">
        <span className="state-symbol">{state[0]}</span>
        <h2>{state[1]}</h2>
        <p>{state[2]}</p>
        <LinkButton page={state[4]} primary>
          {state[3]}
        </LinkButton>
      </div>
    );
  }
  if (!c.siteId)
    return (
      <Notice>
        请先添加网站后查看分析。<LinkButton page="websites">网站管理</LinkButton>
      </Notice>
    );
  switch (page) {
    case 'performance':
      return <Performance />;
    case 'revenue':
      return <Revenue />;
    case 'heatmaps':
      return <Heatmaps />;
    case 'replays':
      return <Replays />;
    case 'replay-player':
      return <ReplayPlayer key={`${c.siteId}:${c.route.id}`} />;
    case 'exports':
      return <Exports key={c.siteId} />;
    default:
      return null;
  }
}
