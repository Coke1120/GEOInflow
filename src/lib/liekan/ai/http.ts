import { after } from 'next/server';
import { readBody } from '../http';
import { authenticateAiRequest, type AiActor } from '../upstream/ai-access';
import { AiError, safeAiError } from './error';
import type { AiRunHandle } from './runs';
import { cancelAiRun, heartbeatAiRun, failAiRun, getAiRun, AI_TERMINAL } from './runs';
import type { AiEventName } from './events';
export const aiPrivateHeaders = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
export async function readAiBody(request: Request) {
  try {
    return await readBody(request, 32768);
  } catch (error) {
    throw new AiError(
      'invalid_request',
      (error as any)?.status === 413 ? '请求内容超过 32 KiB' : '请求 JSON 格式无效',
      (error as any)?.status === 413 ? 413 : 400,
    );
  }
}
export async function aiApi(request: Request, work: (actor: AiActor) => Promise<unknown>) {
  let authenticated = false;
  try {
    const actor = await authenticateAiRequest(request);
    authenticated = true;
    const result = await work(actor);
    if (result instanceof Response) {
      for (const [key, value] of Object.entries(aiPrivateHeaders)) result.headers.set(key, value);
      return result;
    }
    return Response.json(result, { headers: aiPrivateHeaders });
  } catch (error) {
    const safe = safeAiError(error);
    return Response.json(
      { error: { code: safe.code, message: safe.message, status: safe.status } },
      {
        status: safe.status,
        headers: {
          ...aiPrivateHeaders,
          ...(safe.retryAfter ? { 'Retry-After': String(safe.retryAfter) } : {}),
        },
      },
    );
  } finally {
    try {
      if (authenticated)
        after(async () => {
          const { cleanupAiData } = await import('./maintenance');
          await cleanupAiData({ apply: true, requestBudget: true }).catch(() => {});
        });
    } catch {
      /* Direct API tests run outside a Next request. */
    }
  }
}
export interface AiExecution {
  actor: AiActor;
  handle: AiRunHandle;
  signal: AbortSignal;
  emit: (type: AiEventName, data: unknown) => void;
}
export async function aiRunResponse(
  request: Request,
  actor: AiActor,
  handle: AiRunHandle,
  execute: (context: AiExecution) => Promise<void>,
) {
  if (!handle.fresh) {
    const dto = await getAiRun(actor, handle.row.id);
    const running = !AI_TERMINAL.has(dto.state);
    return Response.json(dto, {
      status: running ? 202 : 200,
      headers: { ...aiPrivateHeaders, Location: `/api/liekan/ai/runs/${dto.id}` },
    });
  }
  const abort = new AbortController(),
    encoder = new TextEncoder();
  let closed = false,
    sequence = 0,
    count = 0,
    bytes = 0;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const stop = () => {
    if (!abort.signal.aborted) {
      void cancelAiRun(actor, handle.row.id).catch(() => {});
      abort.abort({ code: 'cancelled' });
    }
  };
  request.signal.addEventListener('abort', stop, { once: true });
  if (request.signal.aborted) stop();
  const signal = abort.signal;
  const emit = (type: AiEventName, data: unknown) => {
    if (closed) return;
    const output = encoder.encode(
      `event: ${type}\ndata: ${JSON.stringify({ protocolVersion: 1, runId: handle.row.id, sequence: ++sequence, type, data })}\n\n`,
    );
    count++;
    bytes += output.byteLength;
    if (count > 4096 || bytes > 512 * 1024)
      throw new AiError('oversize', '生成事件超过允许大小', 413);
    try {
      controller.enqueue(output);
    } catch {
      closed = true;
      stop();
    }
  };
  const deadline = setTimeout(
    () => abort.abort({ code: 'timeout' }),
    handle.row.operation === 'test' ? 45000 : 120000,
  );
  let heartbeatBusy = false;
  const heartbeat = setInterval(() => {
    if (heartbeatBusy || closed) return;
    heartbeatBusy = true;
    void (async () => {
      const live = await authenticateAiRequest(request);
      await heartbeatAiRun(live, handle);
      if (!closed) controller.enqueue(encoder.encode(': heartbeat\n\n'));
    })()
      .catch(error => {
        abort.abort({
          code: (error as AiError)?.code === 'cancelled' ? 'cancelled' : 'interrupted',
        });
      })
      .finally(() => {
        heartbeatBusy = false;
      });
  }, 2000);
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      void (async () => {
        try {
          emit('started', { runId: handle.row.id, state: 'accepted' });
          await execute({ actor, handle, signal, emit });
        } catch (error) {
          const code = signal.aborted
            ? ((signal.reason as any)?.code ?? 'cancelled')
            : ((error as any)?.code ?? 'upstream');
          try {
            await failAiRun(
              handle,
              code,
              code === 'cancelled'
                ? 'cancelled'
                : code === 'interrupted'
                  ? 'interrupted'
                  : 'failed',
              (error as any)?.providerResponse,
            );
            const dto = await getAiRun(actor, handle.row.id);
            emit('error', { ...dto.error, state: dto.state });
          } catch {
            try {
              emit('error', {
                code: 'interrupted',
                message: '任务状态暂时无法读取，请稍后回查',
                state: 'interrupted',
              });
            } catch {
              /* Closing an oversized or disconnected stream must still release its timers. */
            }
          }
        } finally {
          clearTimeout(deadline);
          clearInterval(heartbeat);
          request.signal.removeEventListener('abort', stop);
          if (!closed) {
            closed = true;
            try {
              c.close();
            } catch {}
          }
        }
      })();
    },
    cancel() {
      closed = true;
      stop();
      clearTimeout(deadline);
      clearInterval(heartbeat);
      request.signal.removeEventListener('abort', stop);
    },
  });
  return new Response(stream, {
    headers: {
      ...aiPrivateHeaders,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    },
  });
}
