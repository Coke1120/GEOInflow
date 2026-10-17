import { describe, it, expect } from 'vitest';
import { edgeObservation, timestampNanos, applyEdgeCapabilities } from './edge-observation';
describe('B-03/C-02 optional edge evidence', () => {
  it('preserves sub-millisecond fractions and rejects integer timestamps and invalid dates', () => {
    expect(timestampNanos(1790000000000000000)).toBeNull();
    expect(timestampNanos('2026-02-30T00:00:00Z')).toBeNull();
    const start = '2026-10-01T00:00:00.000000001Z';
    expect(
      edgeObservation({
        EdgeStartTimestamp: start,
        EdgeEndTimestamp: '2026-10-01T00:00:00.000100001Z',
      }).fields.edgeDurationMs.value,
    ).toBe(0.1);
    expect(
      edgeObservation({ EdgeStartTimestamp: start, EdgeEndTimestamp: '2026-09-30T23:59:59Z' })
        .fields.edgeDurationMs.state,
    ).toBe('invalid');
    expect(
      edgeObservation({
        EdgeStartTimestamp: '2026-10-01T00:00:00Z',
        EdgeEndTimestamp: '2026-10-01T00:10:00Z',
      }).fields.edgeDurationMs.value,
    ).toBe(600000);
    expect(
      edgeObservation({ EdgeStartTimestamp: start, EdgeEndTimestamp: '2026-10-01T00:11:00Z' })
        .fields.edgeDurationMs.reason,
    ).toBe('over_limit');
  });
  it('isolates malformed fields and distinguishes provider capabilities', () => {
    const value = edgeObservation({
      BotScore: 30,
      BotScoreSrc: 'Not Computed',
      OriginResponseDurationMs: 100,
      OriginResponseStatus: 0,
      EdgeResponseContentType: 'text/html ; charset=utf-8',
    });
    expect(value.fields.BotScore.state).toBe('invalid');
    expect(value.fields.OriginResponseDurationMs.value).toBe(100);
    expect(value.fields.OriginResponseStatus.value).toBe(0);
    expect(value.fields.EdgeResponseContentType.value).toBe('text/html');
    expect(
      applyEdgeCapabilities(value, { VerifiedBotCategory: false }).fields.VerifiedBotCategory.state,
    ).toBe('unsupported');
    expect(applyEdgeCapabilities(value).fields.VerifiedBotCategory.state).toBe('unknown');
    expect(
      applyEdgeCapabilities(value, { VerifiedBotCategory: true }).fields.VerifiedBotCategory.state,
    ).toBe('missing');
  });
});
