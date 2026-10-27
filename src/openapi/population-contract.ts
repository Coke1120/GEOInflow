import { z } from 'zod';
import type { ZodOpenApiOperationObject } from 'zod-openapi';
import { browserPopulationSchema } from '@/lib/liekan/contracts/browser-population';

const website = '/api/websites/{websiteId}';
const totals = ['visitors', 'visits', 'bounces', 'totaltime'];
// Each entry follows the corresponding native result contract. No numeric field is
// inferred from its name outside these explicitly selected analytics endpoints.
const fieldsByPath: Record<string, readonly string[]> = {
  [`${website}/sessions`]: ['count'],
  [`${website}/metrics/expanded`]: totals,
  [`${website}/breakdown`]: totals,
  [`${website}/sessions/{sessionId}`]: ['visits', 'totaltime', 'stitchedSessionCount'],
  [`${website}/revenue/sessions`]: ['count'],
  [`${website}/replays`]: ['count'],
  [`${website}/sessions/{sessionId}/replays`]: ['count'],
  [`${website}/sessions/stats`]: ['visitors', 'visits', 'totaltime'],
  [`${website}/events/stats`]: ['visitors', 'visits'],
  [`${website}/session-data/stats`]: ['sessions', 'visits'],
  [`${website}/session-data/properties`]: ['total'],
  [`${website}/session-data/values`]: ['total'],
  [`${website}/session-data/array-series`]: ['y'],
  [`${website}/session-data/date-series`]: ['y'],
  [`${website}/session-data/property-series`]: ['y'],
  [`${website}/session-data/numeric-series`]: ['y'],
  [`${website}/session-data/numeric-stats`]: ['total', 'average', 'median', 'min', 'max'],
  [`${website}/session-data-pivot`]: ['count'],
  [`${website}/heatmaps`]: ['sessions', 'totalSessions'],
  [`${website}/attribution`]: ['value', 'visitors', 'visits'],
  [`${website}/retention`]: ['visitors', 'returnVisitors', 'percentage'],
  [`${website}/journeys`]: ['count'],
  [`${website}/funnels/stats`]: ['visitors', 'previous', 'dropped', 'dropoff', 'remaining'],
  [`${website}/funnels/{funnelId}/stats`]: [
    'visitors',
    'previous',
    'dropped',
    'dropoff',
    'remaining',
  ],
  [`${website}/goals/stats`]: ['num', 'total'],
  [`${website}/goals/{goalId}/stats`]: ['num', 'total'],
  [`${website}/values`]: ['count'],
};
const chartPaths = new Set(['/api/websites/charts', '/api/links/charts', '/api/pixels/charts']);
const objectMetadataPaths = new Set([
  `${website}/active`,
  `${website}/sessions`,
  `${website}/revenue/sessions`,
  `${website}/replays`,
  `${website}/sessions/{sessionId}/replays`,
  `${website}/sessions/stats`,
  `${website}/events/stats`,
  `${website}/session-data-pivot`,
  `${website}/heatmaps`,
  `${website}/attribution`,
  `${website}/sessions/{sessionId}`,
  '/api/realtime/{websiteId}',
]);
const populationJsonSchema = z.toJSONSchema(browserPopulationSchema);

function nullable(schema: any) {
  if (schema?.type === 'number' || schema?.type === 'integer') schema.type = [schema.type, 'null'];
}

function visit(schema: any, fields: readonly string[], allNumbers = false) {
  if (!schema || typeof schema !== 'object' || '_zod' in schema) return;
  if (allNumbers) nullable(schema);
  for (const [name, child] of Object.entries(schema.properties || {})) {
    if (fields.includes(name)) nullable(child);
    visit(child, fields, allNumbers);
  }
  if (schema.items) visit(schema.items, fields, allNumbers);
  if (schema.additionalProperties) visit(schema.additionalProperties, fields, allNumbers);
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    for (const child of schema[key] || []) visit(child, fields, allNumbers);
  }
}

function revenueSchema() {
  const properties = {
    sum: { type: ['number', 'string', 'null'] },
    count: { type: 'number' },
    average: { type: 'number' },
    unique_count: { type: ['number', 'null'] },
    total_sessions: { type: ['number', 'null'] },
    arpu: { type: ['number', 'null'] },
  };
  return { type: 'object', properties, required: Object.keys(properties) };
}

export function applyPopulationResponseContract(
  path: string,
  operation: ZodOpenApiOperationObject,
) {
  const response = operation.responses?.['200'];
  if (!response || typeof response !== 'object' || '$ref' in response) return;
  if (
    !path.startsWith(`${website}/`) &&
    path !== '/api/realtime/{websiteId}' &&
    !chartPaths.has(path)
  )
    return;
  response.headers = {
    ...response.headers,
    'X-Liekan-Population': {
      description:
        'Optional JSON reporting-population metadata. Contains up to four resource-window snapshots, identity status, coverage, reporting revisions and bounded version sets. With metricScope=qualified-browser all metrics use only evidence-qualified browser events; partial coverage retains that subset and excludes missing-input events. Without this scope, partial identity-dependent metrics remain null. Unavailable identity-dependent metrics are null. Truncation is explicit; object responses may carry full metadata.',
      schema: { type: 'string' },
    },
  };
  const media = response.content?.['application/json'];
  if (!media?.schema || typeof media.schema !== 'object' || '_zod' in media.schema) return;
  const schema = media.schema as any;
  visit(
    schema,
    fieldsByPath[path] || [],
    path === `${website}/sessions/weekly` || chartPaths.has(path),
  );
  if (
    [
      `${website}/sessions`,
      `${website}/session-data-pivot`,
      `${website}/revenue/sessions`,
      `${website}/replays`,
      `${website}/sessions/{sessionId}/replays`,
    ].includes(path)
  ) {
    schema.properties = { ...schema.properties, count: { type: ['number', 'null'] } };
  }
  if (path === `${website}/sessions/stats`) {
    schema.properties ||= {};
    for (const field of ['pageviews', 'visitors', 'visits', 'countries', 'events']) {
      schema.properties[field] = {
        type: 'object',
        properties: {
          value: { type: ['visitors', 'visits'].includes(field) ? ['number', 'null'] : 'number' },
        },
        required: ['value'],
      };
    }
    schema.required = ['pageviews', 'visitors', 'visits', 'countries', 'events'];
  }
  if (path === `${website}/sessions/{sessionId}`) {
    schema.properties = {
      ...schema.properties,
      visits: { type: ['number', 'null'] },
      totaltime: { type: ['number', 'string', 'null'] },
      stitchedSessionCount: { type: ['number', 'null'] },
      distinctIds: { type: 'array', items: { type: 'string' } },
    };
  }
  if (path === `${website}/revenue/stats`) {
    Object.assign(schema, revenueSchema());
    schema.properties.comparison = revenueSchema();
    schema.required.push('comparison');
  }
  if (path === '/api/realtime/{websiteId}') {
    nullable(schema.properties?.totals?.properties?.visitors);
    visit(schema.properties?.series?.properties?.visitors, ['y']);
  }
  if (chartPaths.has(path) && schema.properties?.data?.additionalProperties) {
    const entry = schema.properties.data.additionalProperties;
    entry.properties = { ...entry.properties, population: populationJsonSchema };
  }
  if (objectMetadataPaths.has(path) && schema.type === 'object') {
    schema.properties = { ...schema.properties, population: populationJsonSchema };
  }
}
