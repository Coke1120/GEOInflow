import { getPublishedCatalog } from '../crawlers/published';
import { getBrowserRangeSources, type RangeSource } from '../crawlers/range-sources';
import { verificationSnapshots } from '../log-ingestion/ranges';
import type { VerificationSnapshots } from '../rules/verify';
import { collectionRegistryIsCurrent } from './crawler-registry-context';

const RANGE_MAX_AGE = 7 * 86400000;
type ReadResult = { snapshots: VerificationSnapshots; fallback: boolean };
let cached: { key: string; expires: number; value: Promise<ReadResult> } | undefined;
const lastSuccess = new Map<string, VerificationSnapshots>();

function compatibleSnapshots(
  snapshots: VerificationSnapshots,
  sources: readonly RangeSource[],
  allowStale: boolean,
): VerificationSnapshots {
  const now = Date.now();
  return Object.fromEntries(
    Object.entries(snapshots).filter(([name, snapshot]) => {
      const source = sources.find(source => source.names.includes(name));
      const observedAt = Date.parse(snapshot?.retrievedAt);
      return (
        source &&
        snapshot?.source === source.url &&
        Array.isArray(snapshot.prefixes) &&
        snapshot.prefixes.length > 0 &&
        Number.isFinite(observedAt) &&
        observedAt <= now &&
        (allowStale || now - observedAt <= RANGE_MAX_AGE)
      );
    }),
  );
}

// The worker refreshes official ranges hourly. Intake reads local snapshots once per minute.
export async function collectionSnapshots(): Promise<VerificationSnapshots> {
  if (!collectionRegistryIsCurrent()) return {};
  const catalog = getPublishedCatalog();
  const sources = getBrowserRangeSources();
  const key = JSON.stringify([catalog?.version, catalog?.contentHash, sources]);
  let current = cached;
  if (!current || current.key !== key || current.expires <= Date.now()) {
    const entry: NonNullable<typeof cached> = {
      key,
      expires: Date.now() + 60000,
      value: verificationSnapshots()
        .then(snapshots => {
          const value = compatibleSnapshots(snapshots, sources, true);
          if (collectionRegistryIsCurrent()) {
            lastSuccess.delete(key);
            lastSuccess.set(key, value);
            while (lastSuccess.size > 8) lastSuccess.delete(lastSuccess.keys().next().value!);
          }
          return { snapshots: value, fallback: false };
        })
        .catch(() => {
          entry.expires = Date.now() + 5000;
          return { snapshots: lastSuccess.get(key) ?? {}, fallback: true };
        }),
    };
    current = entry;
    cached = entry;
  }
  const result = await current.value;
  // A concurrent pointer read can revoke this request while the local snapshot read is pending.
  if (!collectionRegistryIsCurrent()) return {};
  return compatibleSnapshots(result.snapshots, getBrowserRangeSources(), !result.fallback);
}
