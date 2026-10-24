// Unfinished samples retain their observed lower bound and participate in every rank.
export function summarizeClosedBucketLag(samples, budgetMs = 120000) {
  if (samples.length !== 20 || new Set(samples.map(sample => sample.websiteId)).size !== 20)
    throw new Error('lag-requires-twenty-distinct-sites');
  const ranked = samples
    .map(sample => {
      const censored = sample.delayMs === null;
      const value = censored ? sample.censoredAfterMs : sample.delayMs;
      if (!Number.isFinite(value) || value < 0 || (censored && value < budgetMs))
        throw new Error('lag-sample-invalid');
      return { value, censored };
    })
    .sort((a, b) => a.value - b.value || Number(a.censored) - Number(b.censored));
  const percentile = p => {
    const index = Math.ceil(ranked.length * p) - 1;
    const sample = ranked[index];
    const upper = ranked.map(item => (item.censored ? Infinity : item.value)).sort((a, b) => a - b)[
      index
    ];
    const exact = !sample.censored && upper === sample.value;
    return {
      observedMs: exact ? sample.value : null,
      lowerBoundMs: sample.value,
      upperBoundMs: Number.isFinite(upper) ? upper : null,
      censored: !exact,
      comparison: sample.censored ? 'greater-than' : exact ? 'equal' : 'at-least',
    };
  };
  const completed = ranked.filter(sample => !sample.censored);
  const p95 = percentile(0.95);
  return {
    samples: ranked.length,
    completed: completed.length,
    censored: ranked.length - completed.length,
    completionRate: completed.length / ranked.length,
    percentiles: { p50: percentile(0.5), p95, p99: percentile(0.99) },
    maximumObservedMs: completed.length ? Math.max(...completed.map(sample => sample.value)) : null,
    maximumMs: completed.length === ranked.length ? ranked.at(-1).value : null,
    maximumLowerBoundMs: ranked.at(-1).value,
    p95WithinBudget: !p95.censored && p95.observedMs <= budgetMs,
  };
}
