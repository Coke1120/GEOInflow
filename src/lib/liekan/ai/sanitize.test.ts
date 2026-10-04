import { describe, expect, it } from 'vitest';
import { cleanAiPath, safeAiCount, sanitizeAiText } from './sanitize';

describe('AI outbound privacy boundary', () => {
  it('removes repeated encoded identities, secrets, IPs and query values while retaining ordinary paths', () => {
    const dirty =
      '/users/123456/profile/alice%2540example.com/13800138000/203.0.113.9/550e8400-e29b-41d4-a716-446655440000/sk-canaryKey1234567890?q=canaryKey#canaryKey';
    const clean = cleanAiPath(dirty);
    for (const privateValue of [
      'alice',
      'example.com',
      '13800138000',
      '203.0.113.9',
      '550e8400',
      'canaryKey',
      '123456',
    ])
      expect(clean).not.toContain(privateValue);
    expect(cleanAiPath('/articles/2026/product-12345?tracking=private')).toBe(
      '/articles/2026/product-12345',
    );
    expect(
      sanitizeAiText('客户 alice@example.com 13800138000 IP 203.0.113.9 api_key=canaryKey'),
    ).not.toMatch(/alice|13800138000|203\.0\.113|canaryKey/);
  });
  it('keeps counts exact and rejects unsafe or non-count values', () => {
    expect(safeAiCount(42n)).toBe(42);
    for (const bad of [9007199254740992n, Infinity, NaN, -1, 1.5, undefined, '42'])
      expect(() => safeAiCount(bad)).toThrow();
  });
});

it('redacts credential path values and embedded identity paths in untrusted labels', () => {
  for (const path of [
    '/api_key/test-demo-secret',
    '/password/test-demo-secret',
    '/secrets/test-demo-secret',
    '/API-Keys/test-demo-secret',
    '/credentials/test-demo-secret',
    '/api_key/%2574est-demo-secret',
    '/users/api_key/test-demo-secret',
  ])
    expect(cleanAiPath(path)).not.toContain('test-demo-secret');
  const label = sanitizeAiText(
    'goal /users/test-demo-alice /tokens/test-demo-secret /api_key/test-demo-secret',
  );
  expect(label).not.toContain('test-demo-alice');
  expect(label).not.toContain('test-demo-secret');
  expect(cleanAiPath('/articles/2026/product-12345')).toBe('/articles/2026/product-12345');
});

it('removes complete query fragments from embedded label paths and compound credential path values', () => {
  for (const path of [
    '/auth/reset-password/canarySecretValue',
    '/password-reset/canarySecretValue',
    '/access_token/canarySecretValue',
    '/reset%252dpassword/canarySecretValue',
  ])
    expect(cleanAiPath(path)).not.toContain('canarySecretValue');
  const text = sanitizeAiText('goal /callback?access_token=canarySecretValue#private-fragment');
  expect(text).not.toContain('canarySecretValue');
  expect(text).not.toContain('private-fragment');
  expect(sanitizeAiText('refresh_token=canarySecretValue')).not.toContain('canarySecretValue');
});
it('handles decoded whitespace, empty segments and backslash separators before deciding privacy scope', () => {
  for (const suffix of [
    '%20canarySecretValue',
    '%2520canarySecretValue',
    '%09canarySecretValue',
    '%0AcanarySecretValue',
    '%C2%A0canarySecretValue',
  ]) {
    expect(sanitizeAiText('goal /callback?access_token=' + suffix)).not.toContain(
      'canarySecretValue',
    );
  }
  for (const value of [
    '/auth/reset-password/%2FcanarySecretValue',
    '/auth/reset-password//canarySecretValue',
    '/auth/reset-password/%252FcanarySecretValue',
    '/auth\\reset-password\\canarySecretValue',
  ]) {
    expect(cleanAiPath(value)).not.toContain('canarySecretValue');
    expect(sanitizeAiText('goal ' + value)).not.toContain('canarySecretValue');
  }
});
it('redacts an entire encoded token when decoding would change its privacy boundaries', () => {
  for (const suffix of [
    '%00canarySecretValue',
    '%E2%80%8BcanarySecretValue',
    '%22canarySecretValue',
    '%27canarySecretValue',
  ])
    expect(sanitizeAiText('goal /callback?access_token=' + suffix)).not.toContain(
      'canarySecretValue',
    );
  expect(sanitizeAiText('Bearer%20canarySecretValue')).not.toContain('canarySecretValue');
  for (const value of [
    '/auth/reset-password/abc%2FcanarySecretValue',
    '/auth/reset-password/abc%252FcanarySecretValue',
    '/auth/reset-password/abc/canarySecretValue',
  ]) {
    expect(cleanAiPath(value)).not.toContain('canarySecretValue');
    expect(sanitizeAiText('goal ' + value)).not.toContain('canarySecretValue');
  }
  expect(cleanAiPath('/articles/%E4%B8%AD%E6%96%87')).toBe('/articles/中文');
});

it('keeps raw control and quote characters within an embedded URL privacy scope', () => {
  for (const suffix of [
    '\u0000canarySecretValue',
    '\u200bcanarySecretValue',
    '"canarySecretValue"',
    "'canarySecretValue'",
  ]) {
    expect(sanitizeAiText('goal /callback?access_token=' + suffix)).not.toContain(
      'canarySecretValue',
    );
  }
});
it('checks original control characters before splitting labels into lexical tokens', () => {
  for (const separator of ['\n', '\r', '\t'])
    expect(
      sanitizeAiText('goal /callback?access_token=' + separator + 'canarySecretValue'),
    ).not.toContain('canarySecretValue');
});

it('preserves the privacy scope of a label across raw whitespace and repeated sanitization', () => {
  expect(sanitizeAiText('goal /articles/中文')).toBe('goal /articles/中文');
  for (const separator of [' ', '\u00a0', '\u2028', '\u3000']) {
    for (const prefix of [
      'goal /callback?access_token=',
      'goal /auth/reset-password/',
      'goal https://example.com/callback?token=',
    ]) {
      for (const secret of ['canarySecretValue', '"canarySecretValue"']) {
        const value = prefix + separator + secret;
        expect(sanitizeAiText(value)).not.toContain('canarySecretValue');
        expect(sanitizeAiText(sanitizeAiText(value))).not.toContain('canarySecretValue');
      }
    }
  }
});

it('redacts a rejected encoded boundary together with later raw label values', () => {
  expect(sanitizeAiText('goal /articles/%E4%B8%AD%E6%96%87')).toBe('goal /articles/中文');
  for (const prefix of [
    '/callback%3Faccess_token=',
    '/callback?access_token%3D',
    '/auth%2Freset-password/',
    'https%3A%2F%2Fexample.com/callback?token=',
  ]) {
    const value = 'goal ' + prefix + ' canarySecretValue';
    expect(sanitizeAiText(value)).not.toContain('canarySecretValue');
    expect(sanitizeAiText(sanitizeAiText(value))).not.toContain('canarySecretValue');
  }
});
