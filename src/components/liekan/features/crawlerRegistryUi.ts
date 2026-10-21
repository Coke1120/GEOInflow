import type { CatalogIdentity, CatalogPayload } from '@/lib/liekan/contracts/crawler-registry';
import type { OfficialRuleOption } from '@/lib/liekan/rules/editor';

export type CatalogSection =
  | 'identities'
  | 'platforms'
  | 'products'
  | 'referrals'
  | 'rangeSources'
  | 'verificationMethods';
export const sectionLabels: Record<CatalogSection, string> = {
  identities: '爬虫身份',
  platforms: '平台',
  products: '产品',
  referrals: '引荐域名',
  rangeSources: 'IP 范围来源',
  verificationMethods: '核验方法',
};
export const purposeLabels = {
  training: 'AI 训练',
  search: 'AI 搜索',
  user: '用户触发',
  multi: '多用途',
  other: '其他',
  unknown: '未知',
};
export const formLabels = {
  general: '通用 AI',
  workbench: 'AI 工作台',
  personal_agent: '个人 Agent',
  infrastructure: '基础设施',
  unknown: '未知',
};
export const typeLabels = {
  training: '训练',
  search: '搜索',
  user: '用户触发',
  traditional_search: '传统搜索',
  other: '其他',
};
export const statusLabels: Record<string, string> = {
  active: '启用',
  pending: '待核实',
  inactive: '停用',
  confirmed: '已确认',
  unsupported: '缺少识别能力',
  operator: '官方资料',
  observed: '观测资料',
  draft: '草稿',
  published: '已发布',
  fallback: '本地回退',
  domestic: '国内',
  global: '全球',
  http_crawler: 'HTTP 爬虫',
  robots_purpose: 'robots 用途标记',
  signed_agent: '签名 Agent',
  dns: 'DNS 核验',
  signature: '签名资料',
  edge: '可信边缘核验',
  ai: 'AI 引荐',
  mixed: '混合产品来源',
  documentation: '文档来源',
  added: '新增',
  changed: '修改',
  disabled: '停用或移除',
  publish: '发布',
  rollback: '回滚',
  seed: '初始版本',
};
export function matchesBusinessFilter(identity: CatalogIdentity, filter: string) {
  if (filter === 'all') return true;
  if (filter === 'workbench' || filter === 'personal_agent') return identity.productForm === filter;
  if (filter === 'traditional_search') return identity.type === filter;
  return identity.purpose === filter;
}
export function registryCounts(payload: CatalogPayload) {
  const active = payload.identities.filter(
    item => item.status === 'active' && item.kind !== 'robots_purpose',
  );
  return {
    platforms: payload.platforms.length,
    identities: active.length,
    capable: active.filter(
      item =>
        payload.rangeSources.some(
          source => source.enabled !== false && source.crawlerIds.includes(item.id),
        ) ||
        payload.verificationMethods.some(
          method =>
            method.enabled !== false &&
            method.crawlerIds.includes(item.id) &&
            method.method !== 'signature',
        ),
    ).length,
    pending:
      payload.products.filter(item => item.supportStatus === 'pending').length +
      payload.identities.filter(item => item.status === 'pending').length,
  };
}
export function catalogBotRules(payload: CatalogPayload): OfficialRuleOption[] {
  return payload.identities
    .filter(item => item.kind !== 'robots_purpose' && item.status === 'active')
    .map(item => ({
      name: item.name,
      vendor: item.vendor,
      type: typeLabels[item.type],
      ...(item.kind === 'http_crawler' ? { pattern: item.uaSelector } : {}),
      matchMode: 'token',
      crawlerId: item.id,
      aiEligible: item.aiEligible,
    }));
}
export function updateCatalogRecord(
  payload: CatalogPayload,
  section: CatalogSection,
  record: CatalogPayload[CatalogSection][number],
) {
  const exists = payload[section].some(item => item.id === record.id);
  const next = {
    ...payload,
    [section]: exists
      ? payload[section].map(item => (item.id === record.id ? record : item))
      : [...payload[section], record],
  } as CatalogPayload;
  if (section === 'identities') {
    const identity = record as CatalogIdentity;
    next.rangeSources = next.rangeSources.map(source => ({
      ...source,
      names: source.crawlerIds.map(id => next.identities.find(item => item.id === id)?.name || id),
    }));
    next.products = next.products.map(product => ({
      ...product,
      identityIds: identity.productIds.includes(product.id)
        ? [...new Set([...product.identityIds, identity.id])]
        : product.identityIds.filter(id => id !== identity.id),
    }));
  }
  if (section === 'products') {
    const product = record as CatalogPayload['products'][number];
    next.identities = next.identities.map(identity => ({
      ...identity,
      productIds: product.identityIds.includes(identity.id)
        ? [...new Set([...identity.productIds, product.id])]
        : identity.productIds.filter(id => id !== product.id),
    }));
  }
  return next;
}
export function removeCatalogRecord(payload: CatalogPayload, section: CatalogSection, id: string) {
  return {
    ...payload,
    [section]: payload[section].flatMap(item =>
      item.id !== id
        ? [item]
        : section === 'identities'
          ? [{ ...item, status: 'inactive' }]
          : section === 'products'
            ? [{ ...item, supportStatus: 'inactive' }]
            : ['referrals', 'rangeSources', 'verificationMethods'].includes(section)
              ? [{ ...item, enabled: false }]
              : [],
    ),
  } as CatalogPayload;
}
