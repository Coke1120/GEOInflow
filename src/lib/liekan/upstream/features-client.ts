'use client';
import { isAggregateRequest } from './cache-policy';
import { isReportOwnedBy } from '../contracts/query';
import type { QueryClient } from '@tanstack/react-query';
import { browserReads as reads } from './request-pool';
import {
  clientRequestOptions,
  copyClientFreshness,
  monotonicNow,
  rememberResponseFreshness,
  rememberRequestFreshness,
  rememberAggregateFailure,
} from './client-freshness';
import type { WebsiteSummary } from '../contracts/website-summary';
import { getApiUrl } from '@/lib/api-url';
import { getClientAuthToken, removeClientAuthToken, setClientAuthToken } from '@/lib/client';
import { DATE_RANGE_CONFIG, LOCALE_CONFIG, THEME_CONFIG, TIMEZONE_CONFIG } from '@/lib/constants';
import { consumeReturnUrl } from '@/lib/return-url';
import { getItem, setItem } from '@/lib/storage';
import { setLocale, setTimezone, setUser } from '@/store/app';
import type { ExportFrame, ExportRequest } from '../contracts/exports';
export async function streamFeatureExport(
  websiteId: string,
  body: ExportRequest,
  signal: AbortSignal,
  onFrame: (frame: ExportFrame) => void,
) {
  const response = await fetch(
    new URL(getApiUrl(`/liekan/websites/${websiteId}/exports`), window.location.origin),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${getClientAuthToken() || ''}`,
      },
      body: JSON.stringify(body),
      signal,
      cache: 'no-store',
    },
  );
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new FeatureApiError(
      data?.error?.message || `导出失败 (${response.status})`,
      response.status,
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw new FeatureApiError('导出响应为空', 500);
  const decoder = new TextDecoder();
  let pending = '',
    complete = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      let boundary: number;
      while ((boundary = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, boundary);
        pending = pending.slice(boundary + 1);
        if (!line) continue;
        const frame: ExportFrame = JSON.parse(line);
        if (frame.type === 'error') throw new FeatureApiError(frame.message, frame.status);
        if (frame.type === 'complete') complete = true;
        onFrame(frame);
      }
      if (done) break;
    }
    if (!complete) throw new FeatureApiError('导出传输未完成，请重新生成', 500);
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export class FeatureApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: any,
    public retryAfterMs?: number,
  ) {
    super(message);
  }
}
export { isAggregateRequest } from './cache-policy';

function retryAfter(response: Response) {
  const value = response.headers.get('Retry-After');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const serverTime =
    Number(response.headers.get('X-Liekan-Server-Time')) ||
    Date.parse(response.headers.get('Date') || '');
  return Math.max(0, Date.parse(value) - (Number.isFinite(serverTime) ? serverTime : Date.now()));
}
export async function featureRequest<T = any>(
  method: string,
  path: string,
  params?: Record<string, any>,
  signal?: AbortSignal,
  shareToken?: string,
  tokenOverride?: string,
  options?: { priority?: 'foreground' | 'prefetch' },
): Promise<T> {
  const url = new URL(getApiUrl(path), window.location.origin);
  const aggregate = method === 'GET' && isAggregateRequest(path, params);
  const context = clientRequestOptions(signal);
  if (method === 'GET' && params)
    for (const [key, value] of Object.entries(params)) {
      if (value != null && value !== '')
        url.searchParams.set(
          key,
          typeof value === 'object' ? JSON.stringify(value) : String(value),
        );
    }
  if (aggregate && context?.refresh) url.searchParams.set('refresh', '1');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (shareToken) {
    headers['x-umami-share-token'] = shareToken;
    headers['x-umami-share-context'] = '1';
  } else {
    const token = tokenOverride ?? getClientAuthToken();
    if (token) headers.authorization = `Bearer ${token}`;
  }
  const load = async (requestSignal?: AbortSignal) => {
    const startedAt = monotonicNow();
    const response = await fetch(url, {
      method,
      headers,
      signal: requestSignal,
      cache: 'no-store',
      ...(method !== 'GET' && params && { body: JSON.stringify(params) }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok)
      throw new FeatureApiError(
        data?.error?.message || data?.message || `请求失败 (${response.status})`,
        response.status,
        data?.error?.code,
        data?.error,
        retryAfter(response),
      );
    if (aggregate) rememberResponseFreshness(data, response.headers, startedAt);
    return data;
  };
  try {
    const data = await (method === 'GET'
      ? reads.read(
          JSON.stringify([url.href, headers]),
          load,
          signal,
          options?.priority ?? context?.priority,
        )
      : load(signal));
    if (data && typeof data === 'object') rememberRequestFreshness(data, signal);
    return data;
  } catch (error: any) {
    if (aggregate && error && typeof error === 'object' && error.name !== 'AbortError')
      error.aggregate = true;
    throw error;
  }
}
export const featureApi = {
  get: <T = any>(
    path: string,
    params?: Record<string, any>,
    signal?: AbortSignal,
    options?: { priority?: 'foreground' | 'prefetch' },
  ) => featureRequest<T>('GET', path, params, signal, undefined, undefined, options),
  post: <T = any>(path: string, body?: Record<string, any>) =>
    featureRequest<T>('POST', path, body),
  put: <T = any>(path: string, body?: Record<string, any>) => featureRequest<T>('PUT', path, body),
  del: <T = any>(path: string, body?: Record<string, any>) =>
    featureRequest<T>('DELETE', path, body),
};
export function acceptFeatureLogin(response: any) {
  if (response.requiresTwoFactor) {
    sessionStorage.setItem('umami.partial-token', response.partialToken);
    return '/login/two-factor';
  }
  setClientAuthToken(response.token);
  setUser(response.user);
  sessionStorage.removeItem('umami.partial-token');
  return consumeReturnUrl() ?? '/websites';
}
export function clearFeatureLogin() {
  removeClientAuthToken();
  setUser(null);
  sessionStorage.removeItem('umami.partial-token');
}
export async function resumeFeatureLogin(signal?: AbortSignal): Promise<string | null> {
  const token = getClientAuthToken();
  if (!token || signal?.aborted) return null;
  try {
    const user = await featureRequest('POST', '/auth/verify', {}, signal, undefined, token);
    if (signal?.aborted || getClientAuthToken() !== token) return null;
    setUser(user);
    return consumeReturnUrl() ?? '/websites';
  } catch (error) {
    if (signal?.aborted || getClientAuthToken() !== token) return null;
    if (error instanceof FeatureApiError && error.status === 401) {
      clearFeatureLogin();
      return null;
    }
    throw error;
  }
}
export async function refreshFeatureIdentity() {
  const token = getClientAuthToken();
  const user = await featureRequest('POST', '/auth/verify', {}, undefined, undefined, token);
  if (getClientAuthToken() !== token)
    throw new FeatureApiError('登录身份已变更，请重新读取。', 409);
  setUser(user);
  return user;
}
export async function verifyFeatureTwoFactor(body: { token?: string; backupCode?: string }) {
  const token = sessionStorage.getItem('umami.partial-token');
  if (!token) throw new FeatureApiError('验证会话已过期，请重新登录', 401);
  return featureRequest('POST', '/2fa/verify', body, undefined, undefined, token);
}
export async function verifyFeatureSso(token: string) {
  const user = await featureRequest('POST', '/auth/verify', {}, undefined, undefined, token);
  setClientAuthToken(token);
  setUser(user);
  return user;
}
export function featureAssetUrl(file: string) {
  return `${window.location.origin}${process.env.basePath || ''}/${file.replace(/^\/+/, '')}`;
}
export function getFeaturePreferences() {
  return {
    range: getItem(DATE_RANGE_CONFIG) || '24hour',
    timezone: getItem(TIMEZONE_CONFIG) || 'Asia/Shanghai',
    language: getItem(LOCALE_CONFIG) || 'zh-CN',
    theme: getItem(THEME_CONFIG) || 'light',
  };
}

export async function getAllFeatureRows<T = any>(
  path: string,
  params: Record<string, any> = {},
  signal?: AbortSignal,
): Promise<T[]> {
  const data: T[] = [];
  for (let page = 1; ; page++) {
    const result = await featureApi.get(path, { ...params, page, pageSize: 100 }, signal);
    if (Array.isArray(result)) return result;
    const rows = result?.data;
    if (!Array.isArray(rows)) throw new FeatureApiError('列表数据格式不兼容', 500);
    data.push(...rows);
    if (
      !rows.length ||
      data.length >= Number(result.count ?? Infinity) ||
      (!result.count && rows.length < 100)
    )
      return data;
    if (page >= 1000) throw new FeatureApiError('列表超过可加载范围，请缩小条件', 413);
  }
}
export async function getFeatureSites(
  signal?: AbortSignal,
  teamId?: string,
  scope: 'personal' | 'all' = 'all',
): Promise<any[]> {
  if (teamId) return getAllFeatureRows(`/teams/${teamId}/websites`, {}, signal);
  if (scope === 'personal') return getAllFeatureRows('/me/websites', {}, signal);
  const [personal, teams] = await Promise.all([
    getAllFeatureRows('/me/websites', {}, signal),
    getAllFeatureRows<any>('/me/teams', {}, signal),
  ]);
  const collections = await mapFeatureRows(teams, team =>
    getAllFeatureRows(`/teams/${team.id}/websites`, {}, signal),
  );
  return [
    ...new Map([...personal, ...collections.flat()].map((site: any) => [site.id, site])).values(),
  ];
}
export function featureSiteQuery(userId: string, websiteId: string) {
  return {
    queryKey: ['liekan-feature', userId, 'site', websiteId],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      featureApi.get(`/websites/${websiteId}`, {}, signal),
    staleTime: 300000,
    gcTime: 600000,
    retry: false as const,
  };
}
export async function invalidateFeatureUserQueries(client: QueryClient, userId: string) {
  const filters = {
    predicate: (query: { queryKey: readonly unknown[] }) => {
      const key = query.queryKey;
      return key[0] === 'liekan'
        ? isReportOwnedBy(key, userId)
        : (key[0] === 'liekan-feature' && key.includes(userId)) ||
            (key[0] === 'liekan-ai' && key[1] === userId);
    },
  };
  await client.cancelQueries({ ...filters, type: 'inactive' });
  return client.invalidateQueries({ ...filters, refetchType: 'none' });
}
export async function invalidateFeatureWebsiteQueries(client: QueryClient, websiteId: string) {
  const filters = {
    predicate: (query: { queryKey: readonly unknown[] }) => {
      const key = query.queryKey;
      if (key[0] === 'liekan') return key[1] === websiteId;
      if (key[0] === 'liekan-ai')
        return (
          key.includes(websiteId) ||
          ['catalog', 'catalog-selected', 'context'].includes(String(key[2]))
        );
      return (
        key[0] === 'liekan-feature' &&
        (key.includes(websiteId) ||
          key.includes('sites') ||
          key.some(value => Array.isArray(value) && value.includes(websiteId)))
      );
    },
  };
  await client.cancelQueries({ ...filters, type: 'inactive' });
  return client.invalidateQueries({ ...filters, refetchType: 'none' });
}
export async function getFeatureWebsiteSummary(
  ids: string[],
  range: Record<string, any>,
  signal?: AbortSignal,
  get = featureApi.get,
) {
  const sorted = [...new Set(ids)].sort();
  const rows: any[] = [];
  const readChunk = async (chunk: string[]): Promise<any[]> => {
    try {
      const result = await get<WebsiteSummary>(
        '/liekan/websites/summary',
        {
          ids: chunk.join(','),
          startAt: range.startAt,
          endAt: range.endAt,
          timezone: range.timezone,
        },
        signal,
      );
      copyClientFreshness(rows, result);
      return result;
    } catch (error: any) {
      if (error.name === 'AbortError') throw error;
      if ([403, 404].includes(error.status) && chunk.length > 1) {
        const middle = Math.ceil(chunk.length / 2);
        const halves = await Promise.all([
          readChunk(chunk.slice(0, middle)),
          readChunk(chunk.slice(middle)),
        ]);
        return halves.flat();
      }
      return chunk.map(id => ({ id, error }));
    }
  };
  for (let start = 0; start < sorted.length; start += 50)
    rows.push(...(await readChunk(sorted.slice(start, start + 50))));
  if (rows.some(row => row.error))
    rememberAggregateFailure(
      rows,
      Math.max(...rows.map(row => Number(row.error?.retryAfterMs) || 0)),
    );
  return rows;
}
export function saveFeaturePreferences(value: {
  range: string;
  timezone: string;
  language: string;
  theme: string;
}) {
  if (value.language !== 'zh-CN' || value.theme !== 'light')
    throw new FeatureApiError('当前新界面支持简体中文浅色主题', 400);
  try {
    new Intl.DateTimeFormat('zh-CN', { timeZone: value.timezone }).format();
  } catch {
    throw new FeatureApiError('时区无效', 400);
  }
  setItem(DATE_RANGE_CONFIG, value.range);
  setItem(TIMEZONE_CONFIG, value.timezone);
  setItem(LOCALE_CONFIG, value.language);
  setItem(THEME_CONFIG, value.theme);
  setTimezone(value.timezone);
  setLocale(value.language);
}

export async function mapFeatureRows<T, R>(
  items: T[],
  load: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += 4)
    results.push(...(await Promise.all(items.slice(index, index + 4).map(load))));
  return results;
}
