import { createHmac } from 'node:crypto';
import { secret } from '@/lib/crypto';

function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonical(value[key])]),
    );
  return value;
}

export function collectionFingerprint(type: string, payload: Record<string, any>) {
  const { eventId, ...content } = payload;
  return createHmac('sha256', secret())
    .update(JSON.stringify(canonical({ type, payload: content })))
    .digest('hex');
}
