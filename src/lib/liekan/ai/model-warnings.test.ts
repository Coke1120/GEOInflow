// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { callAiModel } from './model';

it('suppresses SDK warnings containing untrusted model identifiers', async () => {
  globalThis.AI_SDK_LOG_WARNINGS = undefined;
  const warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
  try {
    const result = await callAiModel({
      connection: {
        provider: 'custom',
        protocol: 'openai-chat',
        base_url: 'https://models.example.com/v1',
        model: 'isolated-warning-credential',
        capabilities: { keyVerified: { stream: false, structuredOutput: false } },
      } as any,
      apiKey: 'isolated-warning-credential',
      system: 'Return a JSON object.',
      prompt: 'Fixture only.',
      maxOutputTokens: 512,
      signal: new AbortController().signal,
      stream: false,
      onText: () => {},
      schema: z.object({ text: z.string() }),
      fetch: (async () =>
        Response.json({
          id: 'fixture',
          model: 'safe-fixture',
          created: 1,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: '{"text":"LIEKAN_OK"}' },
              finish_reason: 'stop',
            },
          ],
        })) as typeof fetch,
    });
    expect(result.text).toContain('LIEKAN_OK');
    expect(warn).not.toHaveBeenCalled();
  } finally {
    warn.mockRestore();
  }
});
