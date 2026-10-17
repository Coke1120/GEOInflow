import { describe, expect, it } from 'vitest';
import { logMeasurementSchema, samplingAtReceipt } from './measurement';
import { normalizeAutomatic } from './protocol';

const receivedAt = new Date('2026-10-09T02:00:00Z');
const observed = {
  version: 'a'.repeat(64),
  observedAt: '2026-10-09T01:59:00Z',
  samplingRate: 1,
};
const source = 'efc986b6-4e64-43f8-86c8-6d7cc0bda883';
const raw = {
  ClientIP: '192.0.2.9',
  ClientRequestHost: 'example.com',
  ClientRequestMethod: 'GET',
  ClientRequestURI: '/article',
  ClientRequestUserAgent: 'GPTBot',
  EdgeResponseStatus: 200,
  EdgeResponseBodyBytes: 20,
  EdgeStartTimestamp: '2026-10-09T01:00:00Z',
  ClientRequestSource: 'eyeball',
  RayID: 'delayed-before-provider-change',
};

describe('sampling evidence time provenance', () => {
  it('preserves receipt configuration separately for a delayed batch across a sampling change', () => {
    // The old event was produced while the provider sampled; the current health read sees 1.
    const parsed = normalizeAutomatic('cloudflare', source, [raw], 'example.com', 'fixture');
    const measurement = logMeasurementSchema.parse({
      ...parsed.records[0].measurement,
      ...samplingAtReceipt('cloudflare', observed, receivedAt),
    });
    expect(measurement).toMatchObject({
      samplingRate: null,
      samplingBasis: 'unknown',
      providerConfigAtReceipt: { ...observed, receivedAt: receivedAt.toISOString() },
    });
    expect(measurement.samplingTimeBasis).toBeUndefined();
    expect(Date.parse(raw.EdgeStartTimestamp)).toBeLessThan(Date.parse(observed.observedAt));
  });

  it('keeps sampling unknown for events after a provider read and accepts older queue payloads', () => {
    // A provider can change again after the health read, before this later event was produced.
    const parsed = normalizeAutomatic(
      'cloudflare',
      source,
      [{ ...raw, EdgeStartTimestamp: '2026-10-09T01:59:30Z' }],
      'example.com',
      'fixture',
    );
    const legacy = logMeasurementSchema.parse({
      ...parsed.records[0].measurement,
      samplingRate: 1,
      samplingBasis: 'observed_provider_config',
    });
    expect(legacy.samplingTimeBasis).toBeUndefined();
    expect({ ...legacy, ...samplingAtReceipt('cloudflare', observed, receivedAt) }).toMatchObject({
      samplingRate: null,
      samplingBasis: 'unknown',
    });
  });

  it('never accepts event-time sampling claims from public automatic-log fields', () => {
    const forged = {
      ...raw,
      measurement: {
        samplingRate: 1,
        samplingBasis: 'observed_provider_config',
        samplingTimeBasis: 'event_time',
        providerConfigAtReceipt: observed,
      },
    };
    const [record] = normalizeAutomatic(
      'cloudflare',
      source,
      [forged],
      'example.com',
      'fixture',
    ).records;
    expect(record.measurement).toMatchObject({ samplingRate: null, samplingBasis: 'unknown' });
    expect(record.measurement.samplingTimeBasis).toBeUndefined();
    expect(record.measurement.providerConfigAtReceipt).toBeUndefined();
  });

  it('retains only recent, valid Cloudflare provider observations', () => {
    expect(
      samplingAtReceipt('cloudflare', observed, receivedAt).providerConfigAtReceipt,
    ).toBeDefined();
    expect(
      samplingAtReceipt('server', observed, receivedAt).providerConfigAtReceipt,
    ).toBeUndefined();
    expect(
      samplingAtReceipt('cloudflare', observed, new Date('2026-10-09T03:00:00Z'))
        .providerConfigAtReceipt,
    ).toBeUndefined();
    expect(
      samplingAtReceipt('cloudflare', observed, new Date('2026-10-09T01:58:59Z'))
        .providerConfigAtReceipt,
    ).toBeUndefined();
    expect(
      samplingAtReceipt('cloudflare', { ...observed, samplingRate: 0 }, receivedAt)
        .providerConfigAtReceipt,
    ).toBeUndefined();
  });
});
