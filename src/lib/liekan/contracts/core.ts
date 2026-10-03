export interface CoreFunnelFilter {
  property: string;
  operator: 'eq' | 'neq' | 'c' | 'dnc';
  value: string;
}
export interface CoreFunnelStep {
  type: 'path' | 'event';
  value: string;
  filters: CoreFunnelFilter[];
}

export function recorderPayload(values: Record<string, string>) {
  const replayRate = Number(values.replayRate);
  const heatRate = Number(values.heatRate);
  const duration = Number(values.duration);
  if (![replayRate, heatRate].every(rate => Number.isFinite(rate) && rate >= 5 && rate <= 100)) {
    throw new Error('采样率需要在 5% 至 100% 之间。');
  }
  if (![5, 10, 15, 20].includes(duration)) throw new Error('请选择有效的录制时长。');
  return {
    replayConfig: {
      replayEnabled: values.replay === 'on',
      heatmapEnabled: values.heatmap === 'on',
      sampleRate: replayRate / 100,
      heatmapSampleRate: heatRate / 100,
      maskLevel: values.mask === 'strict' ? 'strict' : 'moderate',
      maxDuration: duration * 60_000,
      blockSelector: values.blockSelector?.trim() || '',
    },
  };
}

export function goalPayload(values: Record<string, string>) {
  if (!values.name?.trim() || !values.value?.trim()) throw new Error('请填写目标名称和触发条件。');
  if (!['path', 'event'].includes(values.goalType)) throw new Error('请选择有效的触发类型。');
  return {
    name: values.name.trim(),
    description: values.description?.trim() || '',
    parameters: { type: values.goalType, value: values.value.trim() },
  };
}

export function funnelPayload(values: Record<string, string>, steps: CoreFunnelStep[]) {
  const window = Number(values.window);
  if (!values.name?.trim()) throw new Error('请填写漏斗名称。');
  if (!Number.isFinite(window) || window <= 0) throw new Error('转化窗口需要大于 0。');
  if (steps.length < 2 || steps.length > 8) throw new Error('漏斗需要配置 2 至 8 个步骤。');
  return {
    name: values.name.trim(),
    description: values.description?.trim() || '',
    parameters: {
      window,
      steps: steps.map(step => {
        if (!['path', 'event'].includes(step.type) || !step.value.trim()) {
          throw new Error('请填写每个步骤的行为类型和名称。');
        }
        const filters =
          step.type === 'event'
            ? step.filters.map(filter => {
                if (
                  !filter.property.trim() ||
                  !['eq', 'neq', 'c', 'dnc'].includes(filter.operator)
                ) {
                  throw new Error('请填写有效的事件属性条件。');
                }
                return { ...filter, property: filter.property.trim() };
              })
            : [];
        return {
          type: step.type,
          value: step.value.trim(),
          ...(filters.length ? { filters } : {}),
        };
      }),
    },
  };
}

export function trackerSnippet(
  origin: string,
  basePath: string,
  websiteId: string,
  tab = 'html',
  file = 'script.js',
) {
  const url = `${origin.replace(/\/$/, '')}/${basePath.replace(/^\/+|\/+$/g, '')}/${file}`.replace(
    /([^:]\/)\/+/g,
    '$1',
  );
  const escapeHtml = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const html = `<script defer src="${escapeHtml(url)}"\n  data-website-id="${escapeHtml(websiteId)}"></script>`;
  if (tab === 'next')
    return `import Script from 'next/script';\n\n<Script src=${JSON.stringify(url)}\n  data-website-id=${JSON.stringify(websiteId)} strategy="afterInteractive" />`;
  if (tab === 'gtm') return `标签类型：自定义 HTML\n触发器：All pages\n\n${html}`;
  return html;
}

export function conversionRate(num: unknown, total: unknown) {
  const numerator = Number(num),
    denominator = Number(total);
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
    ? `${((numerator / denominator) * 100).toFixed(2)}%`
    : '—';
}

export function safeCallbackUrl(value: string | null) {
  return value?.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes(':') &&
    !value.includes('\\') &&
    !Array.from(value).some(
      character => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127,
    )
    ? value
    : null;
}

export function featureNavigationPath(value: string, basePath: string) {
  const path = safeCallbackUrl(value);
  if (!path) return '/dashboard';
  if (!basePath) return path;
  if (path === basePath) return '/';
  return path.startsWith(`${basePath}/`) ? path.slice(basePath.length) : path;
}
