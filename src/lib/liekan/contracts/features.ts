export interface FeatureUser {
  id: string;
  username: string;
  role: string;
  isAdmin?: boolean;
}
export interface FeatureEntity {
  id: string;
  name: string;
  domain?: string;
  teamId?: string;
  userId?: string;
  createdAt?: string;
  [key: string]: any;
}
export interface FeatureRange {
  startAt: number;
  endAt: number;
  timezone: string;
  unit: string;
}
export interface FeatureRoute {
  page: string;
  websiteId?: string;
  id?: string;
  teamId?: string;
}
export interface FeaturePageResult<T> {
  data: T[];
  count?: number;
  page?: number;
  pageSize?: number;
}
export const rowsOf = <T>(value: T[] | FeaturePageResult<T>): T[] =>
  Array.isArray(value) ? value : (value?.data ?? []);
export const countOf = (value: any): number =>
  Number(value?.value ?? value?.y ?? value?.count ?? value ?? 0);
export const numberLabel = (value: unknown): string =>
  value == null ? '—' : Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
