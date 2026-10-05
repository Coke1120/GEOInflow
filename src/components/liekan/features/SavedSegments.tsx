'use client';
import Link from 'next/link';
import { getAllFeatureRows } from '@/lib/liekan/upstream/features-client';
import { canManage } from './AnalyticsPages';
import { useData, useFeature } from './context';
import { Button, DialogActions, LiekanDialog, QueryState } from './ui';

function conditionSummary(parameters: any = {}) {
  const fields = {
    referrer: '来源',
    country: '国家 / 地区',
    path: '页面路径',
    device: '设备',
    browser: '浏览器',
    channel: '渠道',
    sessionPlan: '会话属性 · plan',
  };
  const operators = {
    eq: '等于',
    neq: '不等于',
    contains: '包含',
    not_contains: '不包含',
    c: '包含',
    dnc: '不包含',
    re: '匹配正则',
    is: '等于',
    is_not: '不等于',
  };
  const describe = filter =>
    `${fields[filter.name] || filter.name} ${operators[filter.operator] || filter.operator} ${filter.value}`;
  const filters = parameters.filters || [];
  let dimensions = filters.map(describe).join(parameters.match === 'any' ? ' 或 ' : ' 且 ');
  const properties = (parameters.sessionPropertyFilters || [])
    .map(filter => describe({ ...filter, name: `会话属性 · ${filter.propertyName}` }))
    .join(' 且 ');
  if (properties && parameters.match === 'any' && filters.length > 1)
    dimensions = `(${dimensions})`;
  return [dimensions, properties].filter(Boolean).join(' 且 ') || '全部访客';
}

export function SavedSegments({ onClose }: { onClose: () => void }) {
  const c = useFeature();
  const query = useData<any[]>(
    ['saved-segment-picker'],
    signal => getAllFeatureRows(`/websites/${c.siteId}/segments`, { type: 'segment' }, signal),
    !!c.siteId,
  );
  return (
    <LiekanDialog size="wide" title="已保存分群" onClose={onClose}>
      <QueryState query={query}>
        <div className="saved-segments">
          {(query.data || []).map(segment => (
            <div key={segment.id} className="saved-segment-row">
              <div>
                <strong>{segment.name}</strong>
                <p className="muted">{conditionSummary(segment.parameters)}</p>
              </div>
              <Button
                onClick={() => {
                  c.updateQuery({ segment: segment.id, cohort: undefined });
                  onClose();
                }}
              >
                应用
              </Button>
            </div>
          ))}
          {!query.data?.length && <p className="muted">当前网站没有已保存分群。</p>}
        </div>
      </QueryState>
      <DialogActions>
        <Link className="btn" href={c.href('segments')}>
          管理分群
        </Link>
        {canManage(c) && (
          <Link className="btn primary" href={c.href('segment-editor')}>
            创建分群
          </Link>
        )}
      </DialogActions>
    </LiekanDialog>
  );
}
