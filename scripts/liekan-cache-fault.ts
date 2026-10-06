/** A rejected fault-path request is acceptable only with the bounded retry contract. */
export function controlledCacheUnavailable(response: Response, body: unknown, elapsedMs: number) {
  const retry = response.headers.get('retry-after');
  const error = (body as any)?.error;
  return (
    response.status === 503 &&
    response.headers.get('cache-control') === 'private, no-store' &&
    retry !== null &&
    /^[1-9]\d*$/.test(retry) &&
    Number(retry) <= 60 &&
    Number.isFinite(elapsedMs) &&
    elapsedMs >= 0 &&
    elapsedMs < 65000 &&
    error?.status === 503 &&
    typeof error.message === 'string' &&
    error.message.trim().length > 0
  );
}
