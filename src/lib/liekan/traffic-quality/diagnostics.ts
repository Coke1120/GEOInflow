/** Minute counters describe only the observed intersection of the requested range. */
export function diagnosticCoverage(
  start: number,
  end: number,
  startedAt: number | null,
  now: number,
) {
  const retainedFrom = Math.ceil((now - 30 * 86400000) / 60000) * 60000;
  const observedFrom = startedAt === null ? null : Math.max(startedAt, retainedFrom);
  const observedUntil = Math.min(end, now);
  const missing = observedFrom === null || observedFrom >= observedUntil || start > now;
  return {
    coverage: missing
      ? ('missing' as const)
      : start < observedFrom || end > Math.floor(now / 60000) * 60000 + 60000
        ? ('partial' as const)
        : ('complete' as const),
    observedFrom: missing ? null : Math.max(start, observedFrom),
    observedUntil: missing ? null : observedUntil,
    retainedFrom: new Date(retainedFrom).toISOString(),
  };
}
