import type { GeoExclusion, GeoPurpose, GeoReason, GeoWeightState } from './geo-weight';
import type { GeoWeightPoint } from './geo-weight';
export const geoPurposeLabels: Record<GeoPurpose, string> = {
  search: 'AI 搜索',
  user: '用户触发',
  training: 'AI 训练',
};
export const geoStateLabels: Record<GeoWeightState, string> = {
  missing: '待接入日志',
  unavailable: '无可计分证据',
  warming_up: '观察中',
  reference: '参考等级',
  aligned: '观测窗口已对齐',
  observed_zero: '观测零值',
};
export const geoPointStateLabel = (point: GeoWeightPoint) =>
  point.state === 'observed_zero' && point.reasons.length
    ? '观测零值（参考）'
    : geoStateLabels[point.state];
export const geoReasonLabels: Record<GeoReason, string> = {
  coverage_missing: '缺少连续性证据',
  coverage_partial: '存在已知缺口',
  backlog: '存在待处理日志',
  sampling_unknown: '缺少事件时未采样证据',
  host_inferred: '主机依据有限',
  classification_changed: '分类版本不可直接比较',
  source_changed: '来源边界发生变化',
  catalog_fallback: '使用完整回退目录',
  identity_incomplete: '部分身份依据不足',
  content_inferred: '部分内容按路径判断',
  content_mixed: '内容识别依据混合',
  history_incomplete: '历史身份依据不足',
};
export const geoExclusionLabels: Record<GeoExclusion, string> = {
  self_check: '系统自检',
  host: '主机范围不符或缺失',
  ambiguous: '身份存在歧义',
  outside_scope: '评分范围外',
  history: '历史身份依据不足',
  semantics: '身份用途或归属不符',
  verification: '身份未通过范围核验',
  response: '方法或响应不符合条件',
  content: '内容条件不符',
};
