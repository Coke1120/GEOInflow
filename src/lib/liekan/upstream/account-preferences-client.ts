'use client';
import { getClientAuthToken } from '@/lib/client';
import { DATE_RANGE_CONFIG, TIMEZONE_CONFIG } from '@/lib/constants';
import { getItem, setItem } from '@/lib/storage';
import { setAccountPreferences, useApp } from '@/store/app';
import {
  accountPreferencesSchema,
  type AccountPreferences,
} from '../contracts/account-preferences';
import { featureRequest } from './features-client';

const path = '/liekan/account/preferences';

function accept(value: unknown, token: string) {
  const preferences = accountPreferencesSchema.parse(value);
  if (getClientAuthToken() !== token) throw new Error('登录身份已变更，请重新读取偏好');
  setItem(TIMEZONE_CONFIG, preferences.timezone);
  setItem(DATE_RANGE_CONFIG, preferences.range);
  setAccountPreferences(preferences);
  return preferences;
}

export async function loadAccountPreferences(signal?: AbortSignal): Promise<AccountPreferences> {
  const token = getClientAuthToken();
  const preferences = await featureRequest('GET', path, undefined, signal);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  // POST is insert-only. An existing account preference always wins over another browser.
  const initialized = preferences.updatedAt
    ? preferences
    : await featureRequest(
        'POST',
        path,
        {
          ...(getItem(TIMEZONE_CONFIG) ? { timezone: getItem(TIMEZONE_CONFIG) } : {}),
          ...(getItem(DATE_RANGE_CONFIG) ? { range: getItem(DATE_RANGE_CONFIG) } : {}),
        },
        signal,
      );
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return accept(initialized, token);
}

export async function saveAccountPreferences(value: {
  countryCode: string;
  timezone: string;
  range?: string;
}) {
  const token = getClientAuthToken();
  return accept(await featureRequest('PATCH', path, value), token);
}

export function useAccountPreferences() {
  return useApp(state => state.accountPreferences);
}
