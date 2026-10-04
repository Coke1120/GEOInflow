import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, type LanguageModel, type LanguageModelUsage, Output, streamText } from 'ai';
import type { z } from 'zod';
import type { AiConnectionRow } from './connections';
import { type AiProviderResponse, type AiSafeError, type AiUsage, safeAiError } from './contracts';
import { resolveAiTemplateConfig } from './templates';
import { AiTransportError, createAiFetch, readAiProviderResponse } from './transport';
export interface AiModelInput {
  connection: AiConnectionRow;
  apiKey: string;
  system: string;
  prompt: string;
  maxOutputTokens: number;
  signal: AbortSignal;
  stream: boolean;
  onText: (text: string) => void;
  schema?: z.ZodType;
  fetch?: typeof fetch;
}
export function providerAiError(error: unknown, signal?: AbortSignal): AiSafeError {
  if (signal?.aborted) {
    const code = (signal.reason as any)?.code;
    return safeAiError(
      ['timeout', 'invalidated', 'interrupted', 'oversize'].includes(code) ? code : 'cancelled',
    );
  }
  let current: any = error;
  for (let i = 0; i < 8 && current; i++, current = current.cause) {
    if (current instanceof AiTransportError) return current.toJSON();
    if (
      [
        'credentials',
        'model',
        'busy',
        'upstream',
        'timeout',
        'network',
        'cancelled',
        'protocol',
        'oversize',
        'unsafe_endpoint',
      ].includes(current.code)
    )
      return safeAiError(current.code);
  }
  return safeAiError('protocol');
}
function usageDto(usage: LanguageModelUsage | undefined): AiUsage | null {
  const n = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null);
  if (!usage) return null;
  const result = {
    inputTokens: n(usage.inputTokens),
    outputTokens: n(usage.outputTokens),
    totalTokens: n(usage.totalTokens),
  };
  return Object.values(result).some(v => v !== null) ? result : null;
}
export function createAiSdkModel(
  input: Pick<AiModelInput, 'connection' | 'apiKey' | 'fetch'> & {
    onResponse?: (metadata: AiProviderResponse) => void;
  },
): LanguageModel {
  const c = input.connection,
    networkFetch =
      input.fetch ??
      createAiFetch({
        baseUrl: c.base_url,
        protocol: c.protocol,
        workspaceId: c.workspace_id,
        // The request's parent signal enforces its 45/120-second operation deadline.
        timeoutMs: 120000,
        onResponse: input.onResponse,
      });
  const fetch: typeof globalThis.fetch = async (url, init) => {
    if (typeof init?.body === 'string' && Buffer.byteLength(init.body, 'utf8') > 32768)
      throw new AiTransportError('oversize');
    const response = await networkFetch(url, init);
    if (input.fetch) input.onResponse?.(readAiProviderResponse(response, input.apiKey));
    return response;
  };
  if (c.protocol === 'anthropic-messages')
    return createAnthropic({
      apiKey: input.apiKey,
      baseURL: c.base_url,
      fetch,
      ...(c.workspace_id ? { headers: { 'anthropic-workspace-id': c.workspace_id } } : {}),
    })(c.model);
  if (c.provider === 'openai')
    return createOpenAI({ apiKey: input.apiKey, baseURL: c.base_url, fetch }).chat(c.model);
  const policy = resolveAiTemplateConfig({
    provider: c.provider,
    protocol: c.protocol,
    baseUrl: c.base_url,
    model: c.model,
  }).requestPolicy;
  return createOpenAICompatible({
    name: c.provider,
    baseURL: c.base_url,
    apiKey: input.apiKey,
    fetch,
    includeUsage: c.capabilities.documented?.usage === true,
    supportsStructuredOutputs: c.capabilities.keyVerified.structuredOutput === true,
    transformRequestBody: body => {
      if (policy?.reasoningEffort) body.reasoning_effort = policy.reasoningEffort;
      if (policy?.thinking) body.thinking = policy.thinking;
      if (policy?.outputTokenField === 'max_completion_tokens') {
        body.max_completion_tokens = body.max_tokens;
        delete body.max_tokens;
      }
      return body;
    },
  }).chatModel(c.model);
}
// JSON escaping must not hide a credential from the successful-response boundary.
function assertNoCredential(value: unknown, apiKey: string) {
  if (value === undefined) return;
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  const decoded = raw.replace(/\\(?:u([0-9a-fA-F]{4})|(["\\/bfnrt]))/g, (_match, hex, escaped) =>
    hex
      ? String.fromCharCode(Number.parseInt(hex, 16))
      : (({ b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' } as Record<string, string>)[escaped] ??
        escaped),
  );
  if (raw.includes(apiKey) || decoded.includes(apiKey)) throw new AiTransportError('protocol');
}
function assertAiFinish(reason: string, text: string) {
  if (reason === 'length') throw new AiTransportError('truncated_output');
  if (reason === 'content-filter') throw new AiTransportError('refused_output');
  if (reason !== 'stop') throw new AiTransportError('protocol');
  if (!text.trim()) throw new AiTransportError('empty_output');
}
export async function callAiModel(input: AiModelInput) {
  // SDK warnings can include untrusted configuration identifiers.
  globalThis.AI_SDK_LOG_WARNINGS = false;
  const normalizedKey = input.apiKey.trim();
  if (!normalizedKey) throw new AiTransportError('invalid_request');
  const start = Date.now(),
    controller = new AbortController(),
    signal = AbortSignal.any([input.signal, controller.signal]);
  let providerResponse: AiProviderResponse | null = null;
  let lastActivity = start,
    firstText: number | null = null,
    text = '',
    pendingPreview = '';
  // Hold enough characters for a complete JSON-escaped credential across deltas.
  const previewTail = normalizedKey.length * 6 + 5;
  const tick = setInterval(() => {
    if (Date.now() - lastActivity >= 30000) controller.abort({ code: 'timeout' });
  }, 250);
  const activity = (fragment: string, visible: boolean) => {
    if (!fragment) return;
    lastActivity = Date.now();
    if (visible) {
      firstText ??= lastActivity - start;
      text += fragment;
      if (Buffer.byteLength(text) > 32768) {
        controller.abort({ code: 'oversize' });
        throw new AiTransportError('oversize');
      }
      pendingPreview += fragment;
      assertNoCredential(pendingPreview, normalizedKey);
      if (pendingPreview.length > previewTail) {
        const length = pendingPreview.length - previewTail;
        input.onText(pendingPreview.slice(0, length));
        pendingPreview = pendingPreview.slice(length);
      }
    }
  };
  try {
    const options = {
      model: createAiSdkModel({
        ...input,
        apiKey: normalizedKey,
        onResponse: metadata => {
          providerResponse = metadata;
        },
      }),
      system: input.system,
      prompt: input.prompt,
      maxOutputTokens: input.maxOutputTokens,
      maxRetries: 0,
      abortSignal: signal,
      telemetry: { isEnabled: false, recordInputs: false, recordOutputs: false },
      ...(input.schema ? { output: Output.object({ schema: input.schema }) } : {}),
      ...(input.connection.provider === 'openai'
        ? {
            providerOptions: {
              openai: { store: false, maxCompletionTokens: input.maxOutputTokens },
            },
          }
        : {}),
    };
    if (input.stream) {
      const result = streamText({ ...options, streamRetries: 0, onError: () => {} });
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') activity(part.text, true);
        else if (part.type === 'reasoning-delta') activity(part.text, false);
        else if (part.type === 'error') throw part.error;
        else if (part.type === 'abort') throw signal.reason;
        else if (['tool-call', 'file', 'source'].includes(part.type))
          throw new AiTransportError('protocol');
      }
      if (signal.aborted) throw signal.reason;
      const finish = await result.finishReason;
      assertAiFinish(finish, text);
      const output = input.schema ? await result.output : undefined;
      assertNoCredential(text, normalizedKey);
      assertNoCredential(output, normalizedKey);
      if (pendingPreview) input.onText(pendingPreview);
      return {
        text,
        output,
        ttftMs: firstText,
        usage: usageDto(await result.totalUsage),
        stream: true,
        providerResponse,
      };
    }
    const result = await generateText(options);
    if (signal.aborted) throw signal.reason;
    if (result.toolCalls.length || result.files.length || result.sources.length)
      throw new AiTransportError('protocol');
    if (Buffer.byteLength(result.text) > 32768) throw new AiTransportError('oversize');
    assertAiFinish(result.finishReason, result.text);
    const output = input.schema ? result.output : undefined;
    assertNoCredential(result.text, normalizedKey);
    assertNoCredential(output, normalizedKey);
    return {
      text: result.text,
      output,
      ttftMs: null,
      usage: usageDto(result.totalUsage),
      stream: false,
      providerResponse,
    };
  } catch (error) {
    const safe = providerAiError(error, signal);
    controller.abort({ code: safe.code });
    throw new AiTransportError(safe.code, providerResponse);
  } finally {
    clearInterval(tick);
  }
}
