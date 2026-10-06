'use client';
import { AiChatPage } from './AiChatPage';
import { AiConfigPage } from './AiConfigPage';
export const aiPages = new Set(['ai-chat', 'ai-config']);
export function AiPages({ page }: { page: string }) {
  return page === 'ai-chat' ? <AiChatPage /> : page === 'ai-config' ? <AiConfigPage /> : null;
}
