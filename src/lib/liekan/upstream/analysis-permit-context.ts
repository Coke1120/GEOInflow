import { AsyncLocalStorage } from 'node:async_hooks';
import { processSingleton } from './process-singleton';
export interface AnalysisPermit {
  token: string;
  epoch: string;
}
const context = processSingleton(
  'analysis-background-permit',
  () => new AsyncLocalStorage<AnalysisPermit>(),
);
export const currentAnalysisPermit = () => context.getStore();
export const withinAnalysisPermit = <T>(lease: AnalysisPermit, work: () => Promise<T>) =>
  context.run(lease, work);
