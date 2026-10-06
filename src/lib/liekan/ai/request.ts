import { createHash } from 'node:crypto';
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export function hashAiRequest(input: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(canonical(input)))
    .digest('hex');
}
