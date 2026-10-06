import {
  rememberFreshness,
  rememberRequestFreshness,
} from '@/lib/liekan/upstream/client-freshness';

/** A successful aggregate fixture carries the same freshness proof as its HTTP response. */
export function freshAggregateFixture<T>(value: T, signal?: AbortSignal): T {
  rememberFreshness(value, Date.now() + 300000);
  if (value && typeof value === 'object') rememberRequestFreshness(value, signal);
  return value;
}
