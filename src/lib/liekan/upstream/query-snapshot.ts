import { AsyncLocalStorage } from 'node:async_hooks';
import { processSingleton } from './process-singleton';
interface SnapshotExecutor {
  aiPrivate?: boolean;
  $executeRawUnsafe: (query: string, ...params: any[]) => unknown;
  $queryRawUnsafe: (query: string, ...params: any[]) => unknown;
}
const snapshots = processSingleton(
  'analytics-query-snapshot',
  () => new AsyncLocalStorage<SnapshotExecutor>(),
);
export const getQuerySnapshot = () => snapshots.getStore();
export function withinQuerySnapshot<T>(executor: SnapshotExecutor, work: () => Promise<T>) {
  return snapshots.run(executor, work);
}
