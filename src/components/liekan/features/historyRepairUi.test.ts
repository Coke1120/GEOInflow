// @vitest-environment node
import { File } from 'node:buffer';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  historyEvidenceRows,
  createHistoryManifest,
  forgetHistoryUpload,
  historyEvidenceRecords,
  repairActionId,
  repairCount,
  repairDifference,
} from './historyRepairUi';
const eventId = 'eacafcba-1d41-4e5c-9ea5-054f07ac6ded';
async function rows(file: File) {
  const result = [];
  for await (const row of historyEvidenceRows(file as any)) result.push(row);
  return result;
}
describe('historical evidence upload boundary', () => {
  it('streams exact event or receipt associations with UTF-8, CRLF and empty lines', async () => {
    const content =
      '\uFEFF' +
      JSON.stringify({ eventId, requestUserAgent: '测试 GPTBot' }) +
      '\r\n\n' +
      JSON.stringify({ clientEventId: eventId, requestUserAgent: 'ClaudeBot' });
    expect(await rows(new File([content], 'input.jsonl'))).toEqual([
      { eventId, requestUserAgent: '测试 GPTBot' },
      { clientEventId: eventId, requestUserAgent: 'ClaudeBot' },
    ]);
  });
  it('retains physical source lines while ignoring empty lines', async () => {
    const result = [];
    for await (const value of historyEvidenceRecords(
      new File(
        [
          '\n' +
            JSON.stringify({ eventId, requestUserAgent: 'GPTBot' }) +
            '\n\n' +
            JSON.stringify({ eventId, requestUserAgent: 'ClaudeBot' }),
        ],
        'input.jsonl',
      ) as any,
    ))
      result.push(value.line);
    expect(result).toEqual([2, 4]);
  });
  it('rejects both identifiers, arbitrary identifiers and raw address fields without echoing evidence', async () => {
    for (const value of [
      { eventId, clientEventId: eventId, requestUserAgent: 'secret-UA' },
      { eventId: 'fake', requestUserAgent: 'secret-UA' },
      { eventId, requestUserAgent: 'secret-UA', ip: 'secret-IP' },
    ]) {
      await expect(rows(new File([JSON.stringify(value)], 'input.jsonl'))).rejects.toThrow(
        '第 1 行证据格式无效',
      );
    }
  });
  it('rejects an oversized line and invalid UTF-8 with bounded generic errors', async () => {
    await expect(rows(new File(['a'.repeat(16385)], 'input.jsonl'))).rejects.toThrow(
      '第 1 行超出证据记录上限',
    );
    await expect(rows(new File([new Uint8Array([0xff])], 'input.jsonl'))).rejects.toThrow('UTF-8');
  });
  it('keeps counts exact beyond the JavaScript safe integer range and preserves missing state', () => {
    expect(repairCount('9007199254740993', 'en-US')).toBe('9,007,199,254,740,993');
    expect(repairDifference('9007199254740993', '9007199254740992', 'en-US')).toBe('1');
    expect(repairCount(undefined, 'en-US')).toBe('未提供');
  });
  it('uses stable distinct UUIDs for chunk retry actions', async () => {
    const id = await repairActionId('upload:append:0');
    expect(id).toMatch(/^[\da-f]{8}-[\da-f]{4}-5[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    expect(await repairActionId('upload:append:0')).toBe(id);
    expect(await repairActionId('upload:append:1')).not.toBe(id);
  });
});

it('clears only the discarded file bookmark so choosing it again starts a fresh upload', () => {
  let value = JSON.stringify({ uploadId: 'old-file', steps: { 'append:0': 2 } });
  const storage = {
    getItem: () => value,
    removeItem: () => {
      value = null;
    },
  };
  forgetHistoryUpload(storage, 'key', 'other-file');
  expect(value).not.toBeNull();
  forgetHistoryUpload(storage, 'key', 'old-file');
  expect(value).toBeNull();
});

it('keeps a 16,000-chunk finalization compact and matches the server digest protocol', () => {
  const manifest = createHistoryManifest(),
    server = createHash('sha256');
  for (let chunk = 0; chunk < 16000; chunk++) {
    const hash = createHash('sha256').update(String(chunk)).digest('hex');
    manifest.append(hash);
    server.update(hash + '\n');
  }
  const manifestDigest = manifest.finish();
  expect(manifestDigest).toBe(server.digest('hex'));
  expect(
    new TextEncoder().encode(JSON.stringify({ manifestDigest, chunks: 16000, rows: 16000 }))
      .byteLength,
  ).toBeLessThan(1024);
});
