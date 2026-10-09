import { getItem, removeItem, setItem } from '@/lib/storage';
import { AUTH_TOKEN } from './constants';

export function getClientAuthToken() {
  return getItem(AUTH_TOKEN);
}

export function setClientAuthToken(token: string) {
  const previous = getClientAuthToken();
  setItem(AUTH_TOKEN, token);
  if (previous !== token && typeof window !== 'undefined')
    window.dispatchEvent(new Event('liekan-credentials-change'));
}

export function removeClientAuthToken() {
  removeItem(AUTH_TOKEN);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('liekan-credentials-change'));
}
