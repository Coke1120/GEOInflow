import { expect, it } from 'vitest';
import { controlledCacheUnavailable } from '../../../../scripts/liekan-cache-fault';

const body = { error: { status: 503, message: '统计服务忙，请稍后重试' } };
const response = (status = 503, headers: Record<string, string> = {}) =>
  new Response(null, {
    status,
    headers: { 'Cache-Control': 'private, no-store', 'Retry-After': '5', ...headers },
  });

it('recognizes a bounded unavailable response while preserving its rejection status', () => {
  const rejected = response();
  expect(rejected.ok).toBe(false);
  expect(controlledCacheUnavailable(rejected, body, 150)).toBe(true);
});
it.each([200, 401, 429, 500, 502])('rejects unexpected fault status %i', status => {
  expect(controlledCacheUnavailable(response(status), body, 150)).toBe(false);
});
it.each(['0', '-1', 'NaN', '61', 'Wed, 21 Oct 2015 07:28:00 GMT', ''])(
  'rejects invalid bounded retry %s',
  retry => {
    expect(controlledCacheUnavailable(response(503, { 'Retry-After': retry }), body, 150)).toBe(
      false,
    );
  },
);
it('requires the retry and no-store headers', () => {
  const missing = response();
  missing.headers.delete('retry-after');
  expect(controlledCacheUnavailable(missing, body, 150)).toBe(false);
  expect(controlledCacheUnavailable(response(503, { 'Cache-Control': 'public' }), body, 150)).toBe(
    false,
  );
});
it.each([65000, 65001, -1, NaN, Infinity])('rejects unbounded elapsed %s', elapsed => {
  expect(controlledCacheUnavailable(response(), body, elapsed)).toBe(false);
});
it.each([null, {}, { error: { status: 503 } }, { error: { status: 500, message: 'error' } }])(
  'requires a useful matching service error %j',
  error => {
    expect(controlledCacheUnavailable(response(), error, 150)).toBe(false);
  },
);
