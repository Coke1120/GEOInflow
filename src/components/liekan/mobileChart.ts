// Responsive display options preserve the original series and full tooltip values.
const list = (value: any) => (Array.isArray(value) ? value : value ? [value] : []);
const dateLabelPattern =
  /^(\d{4}[-/](?:0[1-9]|1[0-2])[-/](?:0[1-9]|[12]\d|3[01]))(?:[ T]((?:[01]\d|2[0-3]):[0-5]\d)(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)?)?$/;
const sameShape = (source: any, values: any[]) => (Array.isArray(source) ? values : values[0]);
export function mobileChartOptions(source: any, width: number, compact: boolean) {
  if (!compact) return source;
  const option = { ...source, animation: false };
  option.tooltip = sameShape(
    source.tooltip || {},
    list(source.tooltip || {}).map(tooltip => ({
      ...tooltip,
      confine: true,
      triggerOn: 'mousemove|click',
      extraCssText: `${tooltip.extraCssText || ''};max-width:${Math.max(120, width - 24)}px;white-space:normal;overflow-wrap:anywhere`,
    })),
  );
  for (const key of ['xAxis', 'yAxis']) {
    if (!source[key]) continue;
    option[key] = sameShape(
      source[key],
      list(source[key]).map(axis => {
        const label = {
          ...axis.axisLabel,
          fontSize: Math.max(11, axis.axisLabel?.fontSize || 0),
          hideOverlap: true,
        };
        if (axis.type === 'category') {
          if (key === 'xAxis') {
            label.interval = Math.max(
              0,
              Math.ceil((axis.data?.length || 0) / Math.max(2, Math.floor(width / 72))) - 1,
            );
            const formatter = label.formatter;
            const timestamps = (axis.data || [])
              .map((value: any) => String(value).match(dateLabelPattern))
              .filter((match: string[] | null) => match?.[2]);
            const dates = new Set(timestamps.map((match: string[]) => match[1]));
            const times = new Set(timestamps.map((match: string[]) => match[2]));
            const showTime = times.size > 1 || [...times].some(time => time !== '00:00');
            label.formatter = (value: string, index: number) => {
              if (typeof formatter === 'function') return formatter(value, index);
              if (typeof formatter === 'string') return formatter.replace('{value}', String(value));
              const match = String(value).match(dateLabelPattern);
              if (match)
                return showTime && match[2]
                  ? `${dates.size > 1 ? `${match[1].slice(5)}\n` : ''}${match[2]}`
                  : match[1].slice(5);
              return value;
            };
          } else {
            label.width = Math.min(104, Math.max(64, width * 0.3));
            label.overflow = 'truncate';
          }
        }
        return { ...axis, ...(axis.type === 'value' ? { splitNumber: 3 } : {}), axisLabel: label };
      }),
    );
  }
  const legendVisible = list(source.legend).some(legend => legend.show !== false);
  if (legendVisible)
    option.legend = sameShape(
      source.legend,
      list(source.legend).map(legend => ({
        ...legend,
        type: 'scroll',
        orient: 'horizontal',
        left: 0,
        right: 0,
        top: null,
        bottom: 0,
        textStyle: { ...legend.textStyle, fontSize: Math.max(11, legend.textStyle?.fontSize || 0) },
      })),
    );
  if (source.grid)
    option.grid = sameShape(
      source.grid,
      list(source.grid).map(grid => ({
        ...grid,
        left:
          option.yAxis && list(option.yAxis).some(axis => axis.type === 'category')
            ? Math.min(112, Math.max(80, width * 0.34))
            : grid.left,
        right: Math.min(48, typeof grid.right === 'number' ? grid.right : 24),
        containLabel: true,
        top: 18,
        bottom: legendVisible ? 60 : 34,
      })),
    );
  option.series = source.series?.map((series: any) =>
    series.type === 'pie' && legendVisible ? { ...series, center: ['50%', '42%'] } : series,
  );
  return option;
}

export function observeChartLayout(
  instance: any,
  element: HTMLElement,
  source: any,
  onError?: () => void,
) {
  const media = window.matchMedia('(max-width: 900px)');
  let signature = '';
  const apply = () => {
    const width = element.clientWidth;
    if (width <= 0) return;
    const compact = media.matches && width <= 540;
    const next = `${compact}:${compact ? Math.round(width) : 0}`;
    if (next !== signature) {
      const option = mobileChartOptions(source, width, compact);
      const current = signature ? instance.getOption() : undefined;
      const restored = { ...option };
      if (option.legend && current?.legend)
        restored.legend = sameShape(
          option.legend,
          list(option.legend).map((legend, i) => ({
            ...legend,
            selected: current.legend[i]?.selected,
            scrollDataIndex: current.legend[i]?.scrollDataIndex,
          })),
        );
      if (option.dataZoom && current?.dataZoom)
        restored.dataZoom = sameShape(
          option.dataZoom,
          list(option.dataZoom).map((zoom, i) => ({
            ...zoom,
            start: current.dataZoom[i]?.start,
            end: current.dataZoom[i]?.end,
          })),
        );
      if (option.series && current?.series)
        restored.series = option.series.map((series: any, i: number) =>
          current.series[i]?.selectedMap
            ? { ...series, selectedMap: current.series[i].selectedMap }
            : series,
        );
      instance.setOption(restored, { notMerge: true });
      signature = next;
    }
    instance.resize();
  };
  const schedule = () => {
    try {
      apply();
    } catch {
      onError?.();
    }
  };
  apply();
  const observer = new ResizeObserver(schedule);
  observer.observe(element);
  media.addEventListener('change', schedule);
  return () => {
    observer.disconnect();
    media.removeEventListener('change', schedule);
  };
}
