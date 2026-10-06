import { expect, it } from 'vitest';
import { chatPreviewSummary } from './AiChatActivity';
it('extracts only a provisional plain summary from partial JSON, including escaped and incomplete Unicode', () => {
  expect(chatPreviewSummary('{"summary":"当前数据\\n稳定\\u4e2')).toBe('当前数据\n稳定');
  expect(chatPreviewSummary('{"summary":"<script>preview</script>","observations":[')).toBe(
    '<script>preview</script>',
  );
  expect(chatPreviewSummary('{"observations":[')).toBe('');
  expect(chatPreviewSummary('plain provisional text')).toBe('plain provisional text');
});
