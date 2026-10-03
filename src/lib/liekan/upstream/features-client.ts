'use client';
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
  ) {
    super(message);
  }
}
export async function featureRequest<T = any>(
  method: string,
  path: string,
  params?: Record<string, any>,
  signal?: AbortSignal,
  shareToken?: string,
  tokenOverride?: string,
): Promise<T> {
  const url = new URL(getApiUrl(path), window.location.origin);
  if (method === 'GET' && params)
    for (const [key, value] of Object.entries(params)) {
      if (value != null && value !== '')
        url.searchParams.set(
          key,
          typeof value === 'object' ? JSON.stringify(value) : String(value),
        );
    }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (shareToken) {
    headers['x-umami-share-token'] = shareToken;
    headers['x-umami-share-context'] = '1';
  } else {
    const token = tokenOverride ?? getClientAuthToken();
    if (token) headers.authorization = `Bearer ${token}`;
  }
  const response = await fetch(url, {
    method,
    headers,
    signal,
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
    );
  return data;
}
export const featureApi = {
  get: <T = any>(path: string, params?: Record<string, any>, signal?: AbortSignal) =>
    featureRequest<T>('GET', path, params, signal),
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
  return consumeReturnUrl() ?? '/dashboard';
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
    return consumeReturnUrl() ?? '/dashboard';
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
  const user = await featureApi.post('/auth/verify', {});
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
  const collections = await Promise.all(
    teams.map(team => getAllFeatureRows(`/teams/${team.id}/websites`, {}, signal)),
  );
  return [
    ...new Map([...personal, ...collections.flat()].map((site: any) => [site.id, site])).values(),
  ];
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
