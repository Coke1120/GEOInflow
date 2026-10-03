import { AsyncLocalStorage } from 'node:async_hooks';
interface SnapshotExecutor {
  $executeRawUnsafe: (query: string, ...params: any[]) => unknown;
  $queryRawUnsafe: (query: string, ...params: any[]) => unknown;
}
const snapshots = new AsyncLocalStorage<SnapshotExecutor>();
export const getQuerySnapshot = () => snapshots.getStore();
export function withinQuerySnapshot<T>(executor: SnapshotExecutor, work: () => Promise<T>) {
  return snapshots.run(executor, work);
}
