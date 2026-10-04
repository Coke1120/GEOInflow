'use client';
import { replaceEqualDeep } from '@tanstack/react-query';
const freshness = new WeakMap<object, number>();
const requests = new WeakMap<AbortSignal, number>();
export const freshnessExpiry = (data: object) => freshness.get(data);
export function rememberFreshness(data: unknown, expiresAt: number) {
  if (data && typeof data === 'object' && Number.isFinite(expiresAt))
    freshness.set(data, expiresAt);
}
export function rememberRequestFreshness(data: object, signal?: AbortSignal) {
  const expiry = freshness.get(data);
  if (signal && expiry != null)
    requests.set(signal, Math.min(requests.get(signal) ?? Infinity, expiry));
}
export async function withClientFreshness<T>(signal: AbortSignal, load: () => Promise<T>) {
  const value = await load();
  const expiry = requests.get(signal);
  if (expiry != null) rememberFreshness(value, expiry);
  return value;
}
export function shareWithFreshness(oldData: unknown, newData: unknown) {
  const shared = replaceEqualDeep(oldData, newData);
  const expiry = newData && typeof newData === 'object' ? freshness.get(newData) : undefined;
  if (expiry != null) rememberFreshness(shared, expiry);
  return shared;
}
export function remainingFreshness(data: any, updatedAt: number, fallback = 30000) {
  const expiresAt =
    data?.meta?.expiresAt ?? (data && typeof data === 'object' ? freshness.get(data) : undefined);
  return Math.max(0, Math.min(300000, (expiresAt ?? updatedAt + fallback) - Date.now()));
}
// TanStack measures staleTime from dataUpdatedAt. Preserve the server's original expiry.
export function freshnessStaleTime(query: any, fallback = 30000) {
  return (
    Math.max(0, Date.now() - query.state.dataUpdatedAt) +
    remainingFreshness(query.state.data, query.state.dataUpdatedAt, fallback)
  );
}
