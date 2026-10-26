'use client';
import { useLiekanI18n } from '@/lib/liekan/i18n/client';

// 产品组件不能直接 import '@/lib/constants'（上游边界）；键名与默认值与
// upstream useFeatureDateRange 的 DATE_RANGE_CONFIG / DEFAULT_DATE_RANGE_VALUE 保持一致。
const STORED_DATE_RANGE_KEY = 'umami.date-range';
const FALLBACK_DATE_RANGE_TOKEN = '0day';

// 顺序即工具栏展示顺序：今天、7 天、30 天，随后是自定义范围控件。
export const QUICK_DATE_RANGES = [
  ['0day', '今天'],
  ['7day', '7 天'],
  ['30day', '30 天'],
] as const;

export type QuickDateRangeToken = (typeof QUICK_DATE_RANGES)[number][0];

const QUICK_TOKENS = new Set<string>(QUICK_DATE_RANGES.map(([token]) => token));

// dateMode === 'default' 必须先于 range: 判断：默认窗口在 URL 里也是 range: 形态。
export function activeQuickDateRange(
  params: { date?: string; dateMode?: string },
  defaultToken?: QuickDateRangeToken,
): QuickDateRangeToken | null {
  if (params.dateMode === 'default') return '0day';
  if (params.date) {
    return QUICK_TOKENS.has(params.date) ? (params.date as QuickDateRangeToken) : null;
  }
  if (defaultToken) return defaultToken;
  // 与 upstream getItem 相同的 SSR 守卫；当前两个调用方都不会在服务端走到这里，防御未来新增调用。
  let raw: string | null = null;
  try {
    raw = typeof window === 'undefined' ? null : localStorage.getItem(STORED_DATE_RANGE_KEY);
  } catch {
    return FALLBACK_DATE_RANGE_TOKEN;
  }
  if (raw && raw !== 'undefined') {
    try {
      const value = JSON.parse(raw);
      return typeof value === 'string' && QUICK_TOKENS.has(value)
        ? (value as QuickDateRangeToken)
        : null;
    } catch {
      return null;
    }
  }
  return FALLBACK_DATE_RANGE_TOKEN as QuickDateRangeToken;
}

export function QuickRangeButtons({
  activeToken,
  onSelect,
  variant = 'chip',
}: {
  activeToken: QuickDateRangeToken | null;
  onSelect: (token: QuickDateRangeToken) => void;
  variant?: 'chip' | 'btn';
}) {
  const i18n = useLiekanI18n();
  return (
    <>
      {QUICK_DATE_RANGES.map(([token, label]) => {
        const active = activeToken === token;
        return (
          <button
            key={token}
            type="button"
            className={variant === 'chip' ? `chip${active ? ' on' : ''}` : 'btn'}
            aria-pressed={active}
            onClick={() => onSelect(token)}
          >
            {i18n.system(label)}
          </button>
        );
      })}
    </>
  );
}
