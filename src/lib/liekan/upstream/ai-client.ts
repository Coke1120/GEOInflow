'use client';
import { type OperationInput, type OperationOutput, UmamiClient } from '@umami/api-client';
import { getApiUrl } from '@/lib/api-url';
import { getClientAuthToken } from '@/lib/client';
import type { AiEvent } from '../ai/events';
export type AiCatalog = OperationOutput<'getLiekanAiCatalog'>;
export type AiConnection = OperationOutput<'createLiekanAiConnection'>;
export type AiConnectionListItem = OperationOutput<'getLiekanAiConnections'>['items'][number];
export type AiRun = OperationOutput<'getLiekanAiRun'>;
export type AiConversation = OperationOutput<'createLiekanAiConversation'>;
export type AiMessage = OperationOutput<'getLiekanAiMessages'>['items'][number];
export type AiContext = OperationOutput<'getLiekanAiContext'>;
export class AiClientError extends Error {
  constructor(
    message: string,
    public code: string,
    public status = 0,
    public runId?: string,
  ) {
    super(message);
    this.name = 'AiClientError';
  }
}
const client = () =>
  new UmamiClient({
    baseUrl: new URL(getApiUrl(''), window.location.origin).toString(),
    token: getClientAuthToken(),
    headers: { 'Cache-Control': 'no-store' },
  });
export const aiClient = {
  catalog: (signal?: AbortSignal) => client().getLiekanAiCatalog({}, { signal }),
  connections: (space: { kind: 'personal' | 'team'; id: string }, signal?: AbortSignal) =>
    client().getLiekanAiConnections({ spaceKind: space.kind, spaceId: space.id }, { signal }),
  createConnection: (input: OperationInput<'createLiekanAiConnection'>) =>
    client().createLiekanAiConnection(input),
  updateConnection: (input: OperationInput<'updateLiekanAiConnection'>) =>
    client().updateLiekanAiConnection(input),
  deleteConnection: (id: string, rowVersion: number) =>
    client().deleteLiekanAiConnection({ id, rowVersion }),
  createConversation: (websiteId: string) => client().createLiekanAiConversation({ websiteId }),
  conversation: (id: string, signal?: AbortSignal) =>
    client().getLiekanAiConversation({ id }, { signal }),
  conversations: (websiteId: string, cursor?: string, signal?: AbortSignal) =>
    client().getLiekanAiConversations({ websiteId, cursor, limit: 25 }, { signal }),
  deleteConversation: (id: string) => client().deleteLiekanAiConversation({ id }),
  messages: (id: string, cursor?: string, signal?: AbortSignal) =>
    client().getLiekanAiMessages({ id, cursor, limit: 20 }, { signal }),
  context: (id: string, contextId: string, signal?: AbortSignal) =>
    client().getLiekanAiContext({ id, contextId }, { signal }),
  run: (id: string, signal?: AbortSignal) => client().getLiekanAiRun({ id }, { signal }),
  findRun: (clientRequestId: string, signal?: AbortSignal) =>
    client().findLiekanAiRun({ clientRequestId }, { signal }),
  cancel: (id: string) => client().cancelLiekanAiRun({ id }),
};
const names = new Set(['started', 'stage', 'delta', 'answer', 'done', 'error']);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
/** POST is deliberately separate from the generated client's JSON response helper. */
export async function streamAiRun(
  path: string,
  body: unknown,
  signal: AbortSignal,
  onEvent: (event: AiEvent) => void,
): Promise<AiRun> {
  const response = await fetch(new URL(getApiUrl(path), window.location.origin), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authorization: `Bearer ${getClientAuthToken() || ''}`,
    },
    body: JSON.stringify(body),
    signal,
    cache: 'no-store',
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new AiClientError(
      error?.error?.message || 'AI 请求暂时无法完成',
      error?.error?.code || 'request_failed',
      response.status,
    );
  }
  if (response.headers.get('content-type')?.includes('application/json'))
    return (await response.json()) as AiRun;
  if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body)
    throw new AiClientError('AI 响应格式无效', 'protocol');
  const reader = response.body.getReader(),
    decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '',
    bytes = 0,
    sequence = 0,
    runId: string | undefined,
    final: AiRun | undefined,
    error: AiClientError | undefined;
  const consume = (block: string) => {
    const lines = block.split('\n');
    const type = lines
      .find(line => line.startsWith('event:'))
      ?.slice(6)
      .trim();
    const data = lines
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())
      .join('\n');
    if (!data) return;
    let event: AiEvent;
    try {
      event = JSON.parse(data);
    } catch {
      throw new AiClientError('AI 事件格式无效', 'protocol', 0, runId);
    }
    if (
      event.protocolVersion !== 1 ||
      !uuid.test(event.runId) ||
      event.sequence !== sequence + 1 ||
      event.type !== type ||
      !names.has(type) ||
      (runId && runId !== event.runId)
    )
      throw new AiClientError('AI 事件顺序或标识无效', 'protocol', 0, runId);
    if (
      (sequence === 0 && event.type !== 'started') ||
      (sequence > 0 && event.type === 'started') ||
      final ||
      error
    )
      throw new AiClientError('AI 任务事件边界无效', 'protocol', 0, runId);
    if (event.type === 'done') {
      const done = event.data as AiRun;
      if (
        !done ||
        done.id !== event.runId ||
        !['completed', 'failed', 'cancelled', 'interrupted', 'invalidated'].includes(done.state)
      )
        throw new AiClientError('AI 任务完成信息无效', 'protocol', 0, runId);
    }
    runId = event.runId;
    sequence = event.sequence;
    if (sequence > 4096) throw new AiClientError('AI 事件超过限制', 'oversize', 0, runId);
    if (event.type === 'done') final = event.data as AiRun;
    if (event.type === 'error') {
      const value = event.data as { code?: string; message?: string };
      error = new AiClientError(
        value?.message || '本次生成未完成',
        value?.code || 'run_failed',
        0,
        runId,
      );
    }
    onEvent(event);
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      bytes += value?.byteLength ?? 0;
      if (bytes > 512 * 1024 + 2048)
        throw new AiClientError('AI 传输超过限制', 'oversize', 0, runId);
      pending += decoder.decode(value, { stream: !done });
      pending = pending.replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = pending.indexOf('\n\n')) >= 0) {
        consume(pending.slice(0, boundary));
        pending = pending.slice(boundary + 2);
      }
      if (new TextEncoder().encode(pending).byteLength > 65536)
        throw new AiClientError('AI 单次事件超过限制', 'oversize', 0, runId);
      if (done) break;
    }
    if (error) throw error;
    if (!final)
      throw new AiClientError(
        '连接已中断，可回查原任务。重新发起将创建新请求。',
        'stream_incomplete',
        0,
        runId,
      );
    return final;
  } catch (error) {
    if (error instanceof AiClientError || signal.aborted) throw error;
    throw new AiClientError('连接已中断，请回查原任务', 'stream_incomplete', 0, runId);
  } finally {
    await reader.cancel().catch(() => {});
  }
}
