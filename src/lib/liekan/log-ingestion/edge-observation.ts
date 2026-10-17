export const EDGE_FIELDS = [
  'BotScore',
  'BotScoreSrc',
  'VerifiedBotCategory',
  'EdgeResponseContentType',
  'OriginResponseDurationMs',
  'OriginResponseStatus',
  'EdgeEndTimestamp',
] as const;
export type EdgeFieldState = 'present' | 'missing' | 'unsupported' | 'invalid' | 'unknown';
export type EdgeField = { value: string | number | null; state: EdgeFieldState; reason?: string };
export type EdgeObservation = { version: 'edge-observation-v1'; fields: Record<string, EdgeField> };

/** Parse RFC3339 fractions as integers before differencing; never parse integer timestamps. */
export function timestampNanos(value: unknown): bigint | null {
  if (typeof value !== 'string') return null;
  const match =
    /^(\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match) return null;
  const ms = Date.parse(match[1] + match[3]);
  if (!Number.isFinite(ms)) return null;
  const date = match[1].slice(0, 10);
  if (new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) return null;
  return BigInt(ms) * 1000000n + BigInt((match[2] || '').padEnd(9, '0'));
}
export function edgeObservation(raw: Record<string, unknown>): EdgeObservation {
  const fields: Record<string, EdgeField> = {};
  function read(
    name: string,
    valid: (value: unknown) => boolean,
    transform = (value: unknown): string | number => value as string | number,
  ) {
    const value = raw[name];
    fields[name] =
      value === undefined || value === null
        ? { value: null, state: 'missing' }
        : valid(value)
          ? { value: transform(value), state: 'present' }
          : { value: null, state: 'invalid' };
  }
  read('BotScore', value => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 99);
  read(
    'BotScoreSrc',
    value => typeof value === 'string' && /^[a-zA-Z][a-zA-Z _-]{0,63}$/.test(value),
    value => String(value).toLowerCase(),
  );
  read(
    'VerifiedBotCategory',
    value => typeof value === 'string' && value.length <= 80 && /^[a-zA-Z0-9 _/-]*$/.test(value),
  );
  read(
    'EdgeResponseContentType',
    value =>
      typeof value === 'string' &&
      /^[\w!#$&^_.+-]+\/[\w!#$&^_.+-]+(?:\s*;[^\r\n]{0,160})?$/.test(value),
    value => String(value).split(';')[0].trim().toLowerCase(),
  );
  read(
    'OriginResponseStatus',
    value =>
      Number.isInteger(value) && (value === 0 || (Number(value) >= 100 && Number(value) <= 599)),
  );
  read(
    'OriginResponseDurationMs',
    value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 600000,
  );
  if (typeof raw.OriginResponseDurationMs === 'number' && raw.OriginResponseDurationMs > 600000)
    fields.OriginResponseDurationMs.reason = 'over_limit';
  const score = fields.BotScore,
    source = fields.BotScoreSrc;
  const notComputed =
    source.state === 'present' &&
    ['not computed', 'not_computed', 'notcomputed'].includes(String(source.value));
  if (score.state === 'present' && (score.value === 0 || notComputed)) {
    score.state =
      (score.value !== 0 && notComputed) ||
      (score.value === 0 && source.state === 'present' && !notComputed)
        ? 'invalid'
        : 'missing';
    score.reason = score.state === 'invalid' ? 'score_source_conflict' : 'not_computed';
    score.value = null;
  }
  const start = timestampNanos(raw.EdgeStartTimestamp),
    end = timestampNanos(raw.EdgeEndTimestamp);
  const duration = start !== null && end !== null ? Number(end - start) / 1000000 : null;
  fields.edgeDurationMs =
    raw.EdgeEndTimestamp === undefined || raw.EdgeEndTimestamp === null
      ? { value: null, state: 'missing' }
      : duration === null || duration < 0 || duration > 600000
        ? {
            value: null,
            state: 'invalid',
            ...(duration !== null && duration > 600000 ? { reason: 'over_limit' } : {}),
          }
        : { value: duration, state: 'present' };
  return { version: 'edge-observation-v1', fields };
}
export function applyEdgeCapabilities(
  observation: EdgeObservation,
  capabilities?: Record<string, boolean>,
): EdgeObservation {
  const fields = Object.fromEntries(
    Object.entries(observation.fields).map(([key, field]) => {
      const capability = capabilities?.[key === 'edgeDurationMs' ? 'EdgeEndTimestamp' : key];
      return [
        key,
        field.state === 'missing' && !field.reason
          ? {
              ...field,
              state:
                capability === false ? 'unsupported' : capability === true ? 'missing' : 'unknown',
            }
          : field,
      ];
    }),
  );
  return { ...observation, fields } as EdgeObservation;
}
