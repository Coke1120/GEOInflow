import { currentCacheContext } from './cache-context';
import { getQuerySnapshot } from './query-snapshot';

/** Keep an uncached native result on one primary reporting generation. */
export async function nativeSnapshot<T>(load: () => Promise<T>): Promise<T> {
  if (getQuerySnapshot()) return load();
  // Load after the native query modules initialize the shared server exports.
  const { reportSnapshot } = await import('./server');
  return reportSnapshot(load, currentCacheContext()?.deadline ?? Date.now() + 60000);
}
