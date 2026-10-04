import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodeUpload, normalizeAutomatic } from './protocol';
import { openSecret, sealSecret, tokenHash } from './secrets';

const source = 'd04e5c89-5a22-4132-bc26-12a3574e8db1';
const generation = '31b52c5c-697d-4a19-bc24-94df3f4cf13e';
const line =
  '192.0.2.20 - - [04/Oct/2026:10:00:00 +0800] "GET /a?secret=test HTTP/1.1" 200 25 "-" "GPTBot"';
const server = (offset: number) => ({ generation, offset, line });
const cf = (time: string) => ({
  ClientIP: '192.0.2.20',
  ClientRequestHost: 'example.com',
  ClientRequestMethod: 'GET',
  ClientRequestURI: '/a?secret=test',
  ClientRequestUserAgent: 'GPTBot',
  EdgeResponseStatus: 200,
  EdgeResponseBodyBytes: 25,
  EdgeStartTimestamp: time,
  RayID: 'same-ray',
  ClientRequestSource: 'eyeball',
});
describe('automatic log wire protocol', () => {
  it('preserves identities across re-batching and strips raw IP and query before persistence', () => {
    const a = normalizeAutomatic(
      'server',
      source,
      [server(0), server(200)],
      'example.com',
      'test-secret',
    );
    const b = normalizeAutomatic('server', source, [server(200)], 'example.com', 'test-secret');
    expect(a.records).toHaveLength(2);
    expect(a.records[1].id).toBe(b.records[0].id);
    expect(a.records[0].id).not.toBe(a.records[1].id);
    expect(a.records[0].path).toBe('/a');
    expect(JSON.stringify(a)).not.toContain('192.0.2.20');
    expect(JSON.stringify(a)).not.toContain('secret=test');
  });
  it('keeps reused Ray IDs distinct at nanosecond precision and excludes internal requests', () => {
    const a = normalizeAutomatic(
      'cloudflare',
      source,
      [
        cf('2026-10-04T02:00:00.000000001Z'),
        cf('2026-10-04T02:00:00.000000002Z'),
        { ...cf('2026-10-04T02:00:01Z'), ClientRequestSource: 'edgeWorkerFetch' },
      ],
      'example.com',
      'secret',
    );
    expect(a.records).toHaveLength(2);
    expect(a.records[0].id).not.toBe(a.records[1].id);
    expect(a.rejected).toBe(1);
  });
  it('rejects foreign hosts, missing mandatory fields and fabricated status/IP', () => {
    const a = normalizeAutomatic(
      'cloudflare',
      source,
      [
        { ...cf('2026-10-04T02:00:00Z'), ClientRequestHost: 'foreign.example' },
        { ...cf('2026-10-04T02:00:00Z'), ClientIP: undefined },
        { ...cf('2026-10-04T02:00:00Z'), EdgeResponseStatus: 0 },
      ],
      'example.com',
      'secret',
    );
    expect(a.records).toHaveLength(0);
    expect(a.errors).toHaveLength(3);
    expect(JSON.stringify(a.errors)).not.toContain('192.0.2');
  });
  it('bounds gzip expansion and accepts only the exact provider test payload', async () => {
    const req = (data: Buffer) =>
      new Request('https://logs.example/upload', {
        method: 'POST',
        body: new Uint8Array(data),
        headers: { 'content-encoding': 'gzip' },
      });
    expect((await decodeUpload(req(gzipSync('{"content":"tests"}')), 'cloudflare')).test).toBe(
      true,
    );
    await expect(
      decodeUpload(req(gzipSync('x'.repeat(11 * 1024 * 1024))), 'cloudflare'),
    ).rejects.toThrow();
    await expect(
      decodeUpload(req(gzipSync('{"content":"tests","ClientIP":"192.0.2.20"}')), 'cloudflare'),
    ).rejects.toThrow();
  });
});
describe('credential protection', () => {
  it('uses authenticated encryption and a purpose binding', () => {
    const key = Buffer.alloc(32, 9).toString('base64');
    const sealed = sealSecret('long-lived-secret', key, source);
    expect(sealed).not.toContain('long-lived-secret');
    expect(openSecret(sealed, key, source)).toBe('long-lived-secret');
    expect(() => openSecret(sealed, key, 'other-source')).toThrow();
    expect(() => openSecret(sealed, Buffer.alloc(32, 10).toString('base64'), source)).toThrow();
    expect(tokenHash('secret')).toHaveLength(64);
  });
});
