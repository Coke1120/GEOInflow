import { AsyncLocalStorage } from 'node:async_hooks';
import { processSingleton } from './process-singleton';
export interface AnalysisPermit {
  token: string;
  epoch: string;
  lane?: 'dashboard';
}
export const analysisPermitTable = (permit: AnalysisPermit) =>
  permit.lane === 'dashboard'
    ? 'liekan_analysis_dashboard_lease'
    : 'liekan_analysis_background_lease';
const context = processSingleton(
  'analysis-background-permit',
  () => new AsyncLocalStorage<AnalysisPermit>(),
);
export const currentAnalysisPermit = () => context.getStore();
export const withinAnalysisPermit = <T>(lease: AnalysisPermit, work: () => Promise<T>) =>
  context.run(lease, work);
