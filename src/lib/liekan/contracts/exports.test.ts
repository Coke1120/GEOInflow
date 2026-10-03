import { describe, it, expect } from 'vitest';
import { safeCsvCell, sanitizeExportValue, exportRequestSchema } from './exports';
describe('real export constraints', () => {
  it('redacts sensitive saved conditions and IPv6 without hiding ordinary paths', () => {
    expect(
      sanitizeExportValue({
        parameters: {
          sessionPropertyFilters: [
            { propertyName: 'apiKey', value: 'sk_live_example' },
            { propertyName: 'plan', value: 'pro' },
          ],
        },
        value: '2001:db8::1',
      }),
    ).toEqual({
      parameters: {
        sessionPropertyFilters: [
          { propertyName: 'apiKey', value: '[已脱敏]' },
          { propertyName: 'plan', value: 'pro' },
        ],
      },
      value: '[已脱敏]',
    });
    expect(
      sanitizeExportValue({ url: 'https://[::1]/x', date: '2026-01-01T12:30:00Z', path: '/docs' }),
    ).toEqual({ url: '[已脱敏]', date: '2026-01-01T12:30:00Z', path: '/docs' });
  });
  it('rejects inverted and oversized date ranges', () => {
    const input = { startAt: 200, endAt: 100, format: 'zip', sections: ['summary'] };
    expect(exportRequestSchema.safeParse(input).success).toBe(false);
    expect(
      exportRequestSchema.safeParse({ ...input, startAt: 0, endAt: 1097 * 86400000 }).success,
    ).toBe(false);
  });
  it('escapes formula cells including leading whitespace and tabs', () => {
    for (const cell of ['=cmd()', ' +cmd()', '\tfoo', '\rcmd', '@SUM(1)', '-1+2'])
      expect(safeCsvCell(cell)).toBe(`'${cell}`);
    expect(safeCsvCell(-12)).toBe(-12);
    expect(safeCsvCell('regular')).toBe('regular');
  });
  it('redacts credentials and raw visitor addresses recursively', () => {
    expect(
      sanitizeExportValue({
        name: 'site',
        apiKey: 'secret',
        nested: { password: 'secret', source: 'https://x.test?q=a@b.com', ip_address: '127.0.0.1' },
        backupCodes: ['abc'],
      }),
    ).toEqual({
      name: 'site',
      apiKey: '[已脱敏]',
      nested: { password: '[已脱敏]', source: '[已脱敏]', ip_address: '[已脱敏]' },
      backupCodes: '[已脱敏]',
    });
  });
});
