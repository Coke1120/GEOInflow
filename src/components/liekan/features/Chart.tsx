'use client';
import { useEffect, useRef, useState } from 'react';
import { Panel } from './ui';
import { observeChartLayout } from '../mobileChart';
import { ChartLoading, Skeleton, useDataLoading } from '../DataLoading';
export interface ChartSeries {
  name: string;
  values: (number | null)[];
  color?: string;
  dashed?: boolean;
}
export function Chart({
  title,
  subtitle,
  labels = [],
  series = [],
  type = 'line',
  height = 280,
  horizontal = false,
  option,
  children,
  onClick,
}: {
  title?: string;
  subtitle?: string;
  labels?: string[];
  series?: ChartSeries[];
  type?: 'line' | 'bar' | 'pie' | 'sankey' | 'heatmap';
  height?: number;
  horizontal?: boolean;
  option?: any;
  children?: any;
  onClick?: (params: any) => void;
}) {
  const loading = useDataLoading();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const ref = useRef<HTMLDivElement>(null),
    click = useRef(onClick);
  click.current = onClick;
  useEffect(() => {
    setFailed(false);
    if (loading) return;
    let chart: any,
      stopLayout: () => void,
      canceled = false;
    void (async () => {
      const echarts = await import('echarts');
      if (canceled || !ref.current) return;
      chart = echarts.init(ref.current);
      const colors = ['#0F62FE', '#4589FF', '#009D9A', '#7C5CFC', '#B7791F', '#9AA3B2'];
      const cartesian = ['line', 'bar'].includes(type);
      const base = {
        color: colors,
        animation: false,
        textStyle: { fontFamily: 'Inter, PingFang SC, sans-serif' },
        tooltip: {
          trigger: ['pie', 'sankey'].includes(type) ? 'item' : 'axis',
          backgroundColor: '#fff',
          borderColor: '#E9ECF1',
          borderWidth: 1,
          textStyle: { color: '#16181D', fontSize: 12 },
          extraCssText: 'box-shadow:0 4px 16px rgba(22,24,29,.08);border-radius:9px',
        },
        legend: {
          right: 8,
          top: 2,
          itemWidth: 10,
          itemHeight: 10,
          textStyle: { fontSize: 11, color: '#697386' },
        },
        grid: { left: 48, right: 24, top: 34, bottom: 26 },
        xAxis: cartesian
          ? {
              type: 'category',
              data: labels,
              boundaryGap: type === 'bar',
              axisLine: { lineStyle: { color: '#E9ECF1' } },
              axisTick: { show: false },
              axisLabel: { fontSize: 10, color: '#9AA3B2' },
            }
          : undefined,
        yAxis: cartesian
          ? {
              type: 'value',
              axisLine: { show: false },
              axisTick: { show: false },
              axisLabel: { fontSize: 10, color: '#9AA3B2' },
              splitLine: { lineStyle: { color: '#E9ECF1', type: 'solid' } },
            }
          : undefined,
        series:
          type === 'pie'
            ? [
                {
                  type: 'pie',
                  radius: ['48%', '70%'],
                  label: { show: false },
                  data: labels.map((name, i) => ({ name, value: series[0]?.values[i] ?? 0 })),
                },
              ]
            : series.map((s, i) => ({
                name: s.name,
                type,
                data: s.values,
                smooth: true,
                showSymbol: false,
                lineStyle: { width: 2.5, color: s.color || colors[i % colors.length] },
                itemStyle: { color: s.color || colors[i % colors.length] },
                barMaxWidth: 24,
              })),
      };
      if (type === 'bar')
        base.series = series.map((s, i) => ({
          name: s.name,
          type: 'bar',
          data: horizontal ? [...s.values].reverse() : s.values,
          barWidth: horizontal ? 14 : 9,
          itemStyle: {
            color: s.color || colors[i % colors.length],
            borderRadius: horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0],
          },
          label: { show: horizontal, position: 'right', fontSize: 11, color: '#697386' },
        })) as any;
      if (horizontal) {
        base.xAxis = { ...base.yAxis, type: 'value' } as any;
        base.yAxis = {
          type: 'category',
          data: [...labels].reverse(),
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { fontSize: 11, color: '#697386' },
        } as any;
        base.grid = { left: 96, right: 56, top: 34, bottom: 26 };
        base.legend = { ...base.legend, show: false } as any;
      }
      if (type === 'line')
        base.series.forEach((s: any, i) => {
          if (series[i]?.dashed) s.lineStyle = { ...s.lineStyle, type: 'dashed', width: 2 };
        });
      const final = {
        ...base,
        ...option,
        tooltip: { ...base.tooltip, ...option?.tooltip },
        legend: { ...base.legend, ...option?.legend },
        grid: { ...base.grid, ...option?.grid },
      };
      if (option?.xAxis) final.xAxis = { ...base.xAxis, ...option.xAxis };
      if (option?.yAxis) final.yAxis = { ...base.yAxis, ...option.yAxis };
      if (option?.series && ['line', 'bar'].includes(type))
        final.series = option.series.map((s: any, i: number) => ({
          ...base.series[i],
          ...s,
          lineStyle: { ...(base.series[i] as any)?.lineStyle, ...s.lineStyle },
          itemStyle: { ...(base.series[i] as any)?.itemStyle, ...s.itemStyle },
        }));
      stopLayout = observeChartLayout(chart, ref.current, final, () => {
        stopLayout?.();
        chart?.dispose();
        chart = undefined;
        if (!canceled) setFailed(true);
      });
      chart.on('click', (params: any) => click.current?.(params));
    })().catch(() => {
      if (!canceled) {
        stopLayout?.();
        chart?.dispose();
        chart = undefined;
        setFailed(true);
      }
    });
    return () => {
      canceled = true;
      stopLayout?.();
      chart?.dispose();
    };
  }, [JSON.stringify({ labels, series, type, horizontal, option }), loading, attempt]);
  const content = (
    <>
      <div
        className="chart"
        style={{ height, position: 'relative' }}
        role={failed ? 'group' : 'img'}
        aria-label={`${title || '统计图表'}${loading ? ': 正在读取' : ''}`}
        aria-busy={loading || undefined}
      >
        <div ref={ref} style={{ width: '100%', height: '100%' }} />
        {loading && <ChartLoading />}
        {failed && (
          <div className="chart-failure" role="alert">
            图表加载失败
            <button className="btn" type="button" onClick={() => setAttempt(value => value + 1)}>
              重试图表
            </button>
          </div>
        )}
      </div>
      <div className="legend-note">
        {loading ? (
          <Skeleton width="12em" />
        ) : !option && !series.some(s => s.values.some(v => v != null)) ? (
          '当前范围没有数据'
        ) : type === 'sankey' ? (
          '点按或悬停查看访客量，点击节点查看路径详情'
        ) : horizontal ? (
          '点按或悬停查看数值，右侧同时显示数量'
        ) : (
          '点按或悬停查看数值，点击图例切换序列'
        )}
      </div>
      {!loading && children}
    </>
  );
  return title ? (
    <Panel title={title} subtitle={subtitle}>
      {content}
    </Panel>
  ) : (
    content
  );
}
Chart.loadingLayout = true;
