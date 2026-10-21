import { getPublishedCatalog } from '../crawlers/published';
import { verificationSnapshots } from '../log-ingestion/ranges';
import type { VerificationSnapshots } from '../rules/verify';

let cached: { version: string; expires: number; value: Promise<VerificationSnapshots> } | undefined;

// The worker refreshes official ranges hourly. Intake caches their small snapshot for one minute.
export function collectionSnapshots(): Promise<VerificationSnapshots> {
  const version = getPublishedCatalog()?.version || 'bundled';
  if (cached && cached.version === version && cached.expires > Date.now()) return cached.value;
  const current = {
    version,
    expires: Date.now() + 60000,
    value: verificationSnapshots().catch(() => {
      current.expires = Date.now() + 5000;
      return {};
    }),
  };
  cached = current;
  return current.value;
}
