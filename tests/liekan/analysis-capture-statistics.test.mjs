import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeClosedBucketLag } from '../../src/test/analysis-capture-statistics.mjs';

const population = (ready = 20) =>
  Array.from({ length: 20 }, (_, index) => ({
    websiteId: `site-${index}`,
    delayMs: index < ready ? 30000 + index * 1000 : null,
    censoredAfterMs: index < ready ? undefined : 120001,
  }));
test('natural closed-bucket p95 uses nearest rank over every site', () => {
  const summary = summarizeClosedBucketLag(population());
  assert.equal(summary.percentiles.p95.observedMs, 48000);
  assert.equal(summary.maximumMs, 49000);
  assert.equal(summary.completionRate, 1);
  assert.equal(summary.p95WithinBudget, true);
});
test('one unfinished site remains visible in p99, completion and maximum', () => {
  const summary = summarizeClosedBucketLag(population(19));
  assert.equal(summary.percentiles.p95.observedMs, 48000);
  assert.equal(summary.percentiles.p99.censored, true);
  assert.equal(summary.maximumMs, null);
  assert.equal(summary.maximumLowerBoundMs, 120001);
  assert.equal(summary.completionRate, 0.95);
});
test('two unfinished sites prevent a passing p95 instead of being dropped', () => {
  const summary = summarizeClosedBucketLag(population(18));
  assert.equal(summary.percentiles.p95.censored, true);
  assert.equal(summary.percentiles.p95.lowerBoundMs, 120001);
  assert.equal(summary.p95WithinBudget, false);
});
test('a measured p95 beyond the unchanged budget fails', () => {
  const samples = population().map(sample => ({ ...sample, delayMs: 120001 }));
  assert.equal(summarizeClosedBucketLag(samples).p95WithinBudget, false);
});
test('censoring preserves percentile intervals when a known late sample can change rank', () => {
  const samples = population(19);
  samples[18].delayMs = 150000;
  const summary = summarizeClosedBucketLag(samples);
  assert.equal(summary.percentiles.p95.observedMs, null);
  assert.equal(summary.percentiles.p95.lowerBoundMs, 120001);
  assert.equal(summary.percentiles.p95.upperBoundMs, 150000);
  assert.equal(summary.percentiles.p99.observedMs, null);
  assert.equal(summary.percentiles.p99.upperBoundMs, null);
  assert.equal(summary.p95WithinBudget, false);
});
test('a fully unfinished population remains unknown above the budget', () => {
  const summary = summarizeClosedBucketLag(population(0));
  assert.equal(summary.completed, 0);
  assert.equal(summary.percentiles.p95.observedMs, null);
  assert.equal(summary.percentiles.p95.lowerBoundMs, 120001);
  assert.equal(summary.maximumObservedMs, null);
  assert.equal(summary.maximumMs, null);
  assert.equal(summary.p95WithinBudget, false);
});
test('missing sites, duplicate identities and premature censoring are rejected', () => {
  assert.throws(() => summarizeClosedBucketLag(population().slice(1)));
  assert.throws(() =>
    summarizeClosedBucketLag(population().map(sample => ({ ...sample, websiteId: 'same' }))),
  );
  assert.throws(() =>
    summarizeClosedBucketLag(population(0).map(sample => ({ ...sample, censoredAfterMs: 119999 }))),
  );
});
