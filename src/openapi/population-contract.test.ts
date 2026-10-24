import { describe, expect, it } from 'vitest';
import { defineOperation } from './operation';

function response(path: string, schema: any) {
  return defineOperation({
    method: 'get',
    path: path as `/${string}`,
    audience: 'public',
    auth: 'bearer',
    operation: {
      responses: { '200': { description: 'OK', content: { 'application/json': { schema } } } },
    },
  }).operation.responses['200'] as any;
}

describe('native identity availability contracts', () => {
  it('marks only identity-dependent expanded metrics nullable, preserving PV and revenue', () => {
    const schema = {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          pageviews: { type: 'number' },
          visitors: { type: 'number' },
          visits: { type: 'number' },
          bounces: { type: 'number' },
          totaltime: { type: 'number' },
        },
      },
    };
    const result = response('/api/websites/{websiteId}/metrics/expanded', schema);
    expect(result.content['application/json'].schema.items.properties.visitors.type).toEqual([
      'number',
      'null',
    ]);
    expect(result.content['application/json'].schema.items.properties.pageviews.type).toBe(
      'number',
    );
    expect(result.headers['X-Liekan-Population']).toBeDefined();
    expect(
      response('/api/websites/{websiteId}/revenue/chart', {
        type: 'object',
        properties: { count: { type: 'number' }, sum: { type: 'number' } },
      }).content['application/json'].schema.properties.count.type,
    ).toBe('number');
  });
  it('represents unavailable weekly points and list totals while retaining array wire shapes', () => {
    const weekly = response('/api/websites/{websiteId}/sessions/weekly', {
      type: 'array',
      items: { type: 'array', items: { type: 'number' } },
    }).content['application/json'].schema;
    expect(weekly.type).toBe('array');
    expect(weekly.items.items.type).toEqual(['number', 'null']);
    const paged = response('/api/websites/{websiteId}/session-data-pivot', {
      type: 'object',
      properties: { count: { type: 'number' }, page: { type: 'number' } },
    }).content['application/json'].schema;
    expect(paged.properties.count.type).toEqual(['number', 'null']);
    expect(paged.properties.page.type).toBe('number');
  });
  it('documents revenue ratios separately from countable revenue totals', () => {
    const schema = response('/api/websites/{websiteId}/revenue/stats', {
      type: 'object',
      properties: { comparison: {} },
    }).content['application/json'].schema;
    expect(schema.properties.unique_count.type).toEqual(['number', 'null']);
    expect(schema.properties.arpu.type).toEqual(['number', 'null']);
    expect(schema.properties.count.type).toBe('number');
    expect(schema.properties.comparison.properties.arpu.type).toEqual(['number', 'null']);
  });
});

it('preserves decimal revenue wire values and nullable nested session metrics', () => {
  const revenue = response('/api/websites/{websiteId}/revenue/stats', {
    type: 'object',
    properties: {},
  }).content['application/json'].schema;
  expect(revenue.properties.sum.type).toEqual(['number', 'string', 'null']);
  const stats = response('/api/websites/{websiteId}/sessions/stats', {
    type: 'object',
    properties: Object.fromEntries(
      ['visitors', 'visits', 'pageviews'].map(field => [
        field,
        { type: 'object', properties: { value: { type: 'number' } } },
      ]),
    ),
  }).content['application/json'].schema;
  expect(stats.properties.visitors.properties.value.type).toEqual(['number', 'null']);
  expect(stats.properties.pageviews.properties.value.type).toBe('number');
  expect(stats.properties.population.properties.governanceProcessing).toBeDefined();
  for (const path of [
    'sessions',
    'session-data-pivot',
    'revenue/sessions',
    'replays',
    'sessions/{sessionId}/replays',
  ]) {
    const schema = response(`/api/websites/{websiteId}/${path}`, {
      type: 'object',
      properties: { count: { type: 'number' }, page: { type: 'number' } },
    }).content['application/json'].schema;
    expect(schema.properties.count.type).toEqual(['number', 'null']);
    expect(schema.properties.page.type).toBe('number');
  }
});

it('documents native session stats and detail even when source inference returns opaque properties', () => {
  const stats = response('/api/websites/{websiteId}/sessions/stats', {
    type: 'object',
    properties: {},
  }).content['application/json'].schema;
  expect(stats.properties.visitors.properties.value.type).toEqual(['number', 'null']);
  expect(stats.properties.pageviews.properties.value.type).toBe('number');
  const detail = response('/api/websites/{websiteId}/sessions/{sessionId}', {
    type: 'object',
    properties: { stitchedSessionCount: {} },
  }).content['application/json'].schema;
  expect(detail.properties.stitchedSessionCount.type).toEqual(['number', 'null']);
  expect(detail.properties.visits.type).toEqual(['number', 'null']);
  expect(detail.properties.totaltime.type).toEqual(['number', 'string', 'null']);
});
