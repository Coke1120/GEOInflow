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

it('localizes controlled activity failures while retaining the original model preview', async () => {
  const { render, screen } = await import('@testing-library/react');
  const { LiekanLocaleContext } = await import('@/lib/liekan/i18n/client');
  const { ChatActivity } = await import('./AiChatActivity');
  const { aiError } = await import('./AiShared');
  const controlledError = aiError({ code: 'credentials' });
  const original = '历史模型预览：网站管理';
  render(
    <LiekanLocaleContext.Provider value="en-US">
      <ChatActivity busy={false} error={controlledError} preview={original} stage="failed" />
    </LiekanLocaleContext.Provider>,
  );
  expect(screen.getByRole('alert').querySelector('p')).not.toHaveTextContent(controlledError);
  expect(screen.getByText(original)).toBeInTheDocument();
});
