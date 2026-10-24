import { AsyncLocalStorage } from 'node:async_hooks';
import { processSingleton } from './process-singleton';

const clock = processSingleton(
  'dashboard-clock',
  () => new AsyncLocalStorage<{ cutoff: number; dayAt: number }>(),
);
export const dashboardClock = () => clock.getStore();
export function withDashboardClock<T>(cutoff: number, work: () => Promise<T>) {
  return clock.run({ cutoff, dayAt: Date.now() }, work);
}
