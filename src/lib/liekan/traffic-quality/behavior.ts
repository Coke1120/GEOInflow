export const BROWSER_RISK_VERSION = 'browser-behavior-v1';
export const BROWSER_RISK_WINDOW_MS = 5 * 60000;
export const BROWSER_RISK_WINDOW_LIMIT = 10000;
export type BehaviorEvent = { observedAt: number; path: string | null };
function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b),
    middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
/** Explain observed request patterns. These findings never establish human/bot identity. */
export function assessBrowserBehavior(events: BehaviorEvent[], complete = true) {
  const sorted = [...events]
    .filter(e => Number.isFinite(e.observedAt))
    .sort((a, b) => a.observedAt - b.observedAt);
  const durationMs = sorted.length > 1 ? sorted.at(-1)!.observedAt - sorted[0].observedAt : 0;
  const paths = new Map<string, number>();
  let left = 0,
    peakMinute = 0;
  for (let right = 0; right < sorted.length; right++) {
    while (sorted[right].observedAt - sorted[left].observedAt >= 60000) left++;
    peakMinute = Math.max(peakMinute, right - left + 1);
    if (sorted[right].path !== null)
      paths.set(sorted[right].path!, (paths.get(sorted[right].path!) || 0) + 1);
  }
  const gaps = sorted.slice(1).map((e, i) => e.observedAt - sorted[i].observedAt);
  const medianGapMs = gaps.length ? median(gaps) : null;
  const relativeMad = medianGapMs
    ? median(gaps.map(g => Math.abs(g - medianGapMs))) / medianGapMs
    : null;
  const timingConcentration = medianGapMs
    ? gaps.filter(g => Math.abs(g - medianGapMs) <= medianGapMs * 0.05).length / gaps.length
    : null;
  const repeatFraction = sorted.length ? Math.max(0, ...paths.values()) / sorted.length : 0;
  const reasons: string[] = [];
  const usable =
    complete && sorted.length === events.length && durationMs <= BROWSER_RISK_WINDOW_MS;
  if (usable && peakMinute >= 60 && sorted.length >= 120) reasons.push('sustained-frequency');
  if (usable && sorted.length >= 30 && durationMs >= 60000) {
    if (
      medianGapMs !== null &&
      medianGapMs >= 500 &&
      medianGapMs <= 10000 &&
      relativeMad !== null &&
      relativeMad <= 0.05 &&
      timingConcentration !== null &&
      timingConcentration >= 0.9
    )
      reasons.push('regular-timing');
    if (repeatFraction >= 0.9) reasons.push('repeated-path');
  }
  return {
    state:
      !usable || sorted.length < 30 || durationMs < 60000
        ? ('insufficient' as const)
        : reasons.length >= 2
          ? ('review' as const)
          : ('observed' as const),
    reasons,
    features: {
      pageviews: sorted.length,
      durationMs,
      peakMinute,
      medianGapMs,
      relativeMad,
      timingConcentration,
      repeatFraction,
    },
  };
}
