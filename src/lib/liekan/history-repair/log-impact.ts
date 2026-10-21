import type { HistoryRepairLogImpact } from '../contracts/history-repair';
import { hash, type LogVerdict } from './model';
const categories: HistoryRepairLogImpact['categories'][number]['category'][] = [
  'all',
  'training',
  'search',
  'user',
  'traditional_search',
  'workbench',
  'personal_agent',
  'other',
  'unknown',
];
export const emptyLogImpact = (): HistoryRepairLogImpact => ({
  categories: categories.map(category => ({ category, beforeRequests: '0', afterRequests: '0' })),
  beforeIdentities: '0',
  afterIdentities: '0',
  beforeAiPages: '0',
  afterAiPages: '0',
});
const purpose: Record<string, string> = {
  训练: 'training',
  搜索: 'search',
  用户触发: 'user',
  传统搜索: 'traditional_search',
};
export function logImpactCategories(value: LogVerdict, form: string | null) {
  const recognized =
    !['unknown', 'ambiguous'].includes(value.recognitionState || '') &&
    (value.recognitionState !== null || value.bot !== '其他');
  const found = ['all'];
  if (purpose[value.botType]) found.push(purpose[value.botType]);
  if (form === 'workbench' || form === 'personal_agent') found.push(form);
  if (!recognized) found.push('unknown');
  else if (!purpose[value.botType] && !['workbench', 'personal_agent'].includes(form || ''))
    found.push('other');
  return {
    categories: found,
    identity: recognized ? value.crawlerId || hash([value.bot, value.vendor]) : null,
    ai: value.aiEligible ?? ['训练', '搜索', '用户触发'].includes(value.botType),
  };
}
export function addLogImpact(
  impact: HistoryRepairLogImpact,
  before: ReturnType<typeof logImpactCategories>,
  after: ReturnType<typeof logImpactCategories>,
): HistoryRepairLogImpact {
  return {
    ...impact,
    categories: impact.categories.map(row => ({
      ...row,
      beforeRequests: (
        BigInt(row.beforeRequests) + BigInt(+before.categories.includes(row.category))
      ).toString(),
      afterRequests: (
        BigInt(row.afterRequests) + BigInt(+after.categories.includes(row.category))
      ).toString(),
    })),
  };
}
export function distinctLogKey(kind: string, key: string) {
  const digest = hash([kind, key]);
  const id = digest.slice(0, 32);
  return {
    session: `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`,
    itemKey: digest,
  };
}
