import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import tls, { type ConnectionOptions, type TLSSocket } from 'node:tls';
import { Agent, fetch as undiciFetch } from 'undici';
import { type AiProviderResponse, type AiSafeError, safeAiError } from './contracts';
import {
  type AiProtocol,
  isPublicAiAddress,
  isValidAiWorkspaceId,
  validateAiEndpoint,
  validateAiRequestUrl,
} from './templates';

const REQUEST_LIMIT = 64 * 1024;
const RESPONSE_LIMIT = 512 * 1024;
// Token streams repeat the provider envelope for each delta; answer text has its own 32 KiB cap.
const SSE_RESPONSE_LIMIT = 2 * 1024 * 1024;
const ERROR_LIMIT = 16 * 1024;
export type AiResolvedAddress = { address: string; family: 4 | 6 };
/** Injection is limited to trusted operating-system boundaries, never a generic fetch bypass. */
export type AiTransportBoundaries = {
  resolve?: (hostname: string) => Promise<readonly AiResolvedAddress[]>;
  dial?: (options: ConnectionOptions) => TLSSocket;
};
export type AiFetchOptions = AiTransportBoundaries & {
  baseUrl: string;
  protocol: AiProtocol;
  timeoutMs?: number;
  workspaceId?: string | null;
  onResponse?: (metadata: AiProviderResponse) => void;
};
export class AiTransportError extends Error {
  readonly code: AiSafeError['code'];
  constructor(
    code: AiSafeError['code'],
    public readonly providerResponse: AiProviderResponse | null = null,
  ) {
    super(safeAiError(code).message);
    this.name = 'AiTransportError';
    this.code = code;
  }
  toJSON(): AiSafeError {
    return safeAiError(this.code);
  }
}
export function readAiProviderResponse(
  response: { status: number; headers: { get: (name: string) => string | null } },
  apiKey: string,
): AiProviderResponse {
  const candidate = response.headers.get('x-request-id') ?? response.headers.get('request-id');
  return {
    status: response.status,
    requestId:
      candidate &&
      candidate.length <= 128 &&
      /^[A-Za-z0-9._:-]+$/.test(candidate) &&
      !candidate.includes(apiKey)
        ? candidate
        : null,
  };
}
function failure(code: AiSafeError['code']): never {
  throw new AiTransportError(code);
}
function route(base: URL, protocol: AiProtocol) {
  return `${base.origin}${base.pathname.replace(/\/$/, '')}${protocol === 'anthropic-messages' ? '/messages' : '/chat/completions'}`;
}
function statusCode(status: number): AiSafeError['code'] {
  if (status === 401 || status === 403) return 'credentials';
  if (status === 404) return 'model';
  if (status === 429) return 'busy';
  if (status >= 500) return 'upstream';
  return 'protocol';
}
function credential(value: string | null): string {
  if (!value || /\p{Cc}/u.test(value) || Buffer.byteLength(value) > 4096)
    failure('invalid_request');
  return value;
}
function approvedHeaders(
  request: Request,
  protocol: AiProtocol,
  workspaceId?: string | null,
): Headers {
  const headers = new Headers({
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  });
  if (
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
  )
    failure('invalid_request');
  if (protocol === 'anthropic-messages') {
    headers.set('x-api-key', credential(request.headers.get('x-api-key')));
    if (request.headers.get('anthropic-version') !== '2023-06-01') failure('invalid_request');
    headers.set('anthropic-version', '2023-06-01');
    const suppliedWorkspace = request.headers.get('anthropic-workspace-id');
    if (suppliedWorkspace !== (workspaceId ?? null)) failure('invalid_request');
    if (workspaceId) headers.set('anthropic-workspace-id', workspaceId);
  } else {
    if (request.headers.has('anthropic-workspace-id')) failure('invalid_request');
    const auth = request.headers.get('authorization');
    if (!auth?.startsWith('Bearer ')) failure('invalid_request');
    headers.set('Authorization', `Bearer ${credential(auth.slice(7))}`);
  }
  return headers;
}
async function boundedBytes(
  body: ReadableStream<Uint8Array> | null,
  cap: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal?.aborted) failure('cancelled');
      const { done, value } = await reader.read();
      if (signal?.aborted) failure('cancelled');
      if (done) break;
      size += value.byteLength;
      if (size > cap) failure('oversize');
      chunks.push(value);
    }
    const output = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  } finally {
    signal?.removeEventListener('abort', abort);
    void reader.cancel().catch(() => {});
  }
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new AiTransportError('cancelled'));
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      value => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      error => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

export function createAiFetch(options: AiFetchOptions): typeof fetch {
  let base: URL;
  try {
    base = validateAiEndpoint(options.baseUrl);
  } catch {
    failure('unsafe_endpoint');
  }
  if (!['openai-chat', 'anthropic-messages'].includes(options.protocol)) failure('invalid_request');
  if (
    options.workspaceId != null &&
    (options.protocol !== 'anthropic-messages' || !isValidAiWorkspaceId(options.workspaceId))
  )
    failure('invalid_request');
  const expectedUrl = route(base, options.protocol);
  const hostname = base.hostname.replace(/^\[|\]$/g, '');
  const resolve =
    options.resolve ??
    (async (host: string) =>
      (await lookup(host, { all: true, verbatim: true })) as AiResolvedAddress[]);
  const dial = options.dial ?? tls.connect;
  const timeoutMs = Math.min(120000, Math.max(1, options.timeoutMs ?? 30000));
  return async (input, init) => {
    // Validate the final SDK URL before materializing the request or reading its body.
    let inputUrl: string;
    try {
      inputUrl = input instanceof Request ? input.url : String(input);
    } catch {
      failure('unsafe_endpoint');
    }
    let canonicalRequestUrl: URL;
    try {
      canonicalRequestUrl = validateAiRequestUrl(inputUrl);
    } catch {
      failure('unsafe_endpoint');
    }
    if (canonicalRequestUrl.href !== expectedUrl) failure('unsafe_endpoint');
    let request: Request;
    try {
      request = new Request(input, init);
    } catch {
      failure('invalid_request');
    }
    if (request.method !== 'POST') failure('invalid_request');
    const headers = approvedHeaders(request, options.protocol, options.workspaceId);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    timer.unref?.();
    const forwardAbort = () => controller.abort();
    request.signal.addEventListener('abort', forwardAbort, { once: true });
    if (request.signal.aborted) controller.abort();
    let agent: Agent | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let finished = false;
    const cleanup = (destroy: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      request.signal.removeEventListener('abort', forwardAbort);
      if (destroy) {
        controller.abort();
        void reader?.cancel().catch(() => {});
        void agent?.destroy().catch(() => {});
      } else {
        void agent?.close().catch(() => {});
      }
    };
    const safeFailure = (error: unknown): AiTransportError => {
      if (timedOut) return new AiTransportError('timeout');
      if (request.signal.aborted) return new AiTransportError('cancelled');
      if (error instanceof AiTransportError) return error;
      return new AiTransportError('network');
    };
    try {
      const body = await boundedBytes(request.body, REQUEST_LIMIT, controller.signal);
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.from(body).toString('utf8'));
      } catch {
        failure('invalid_request');
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        failure('invalid_request');
      const literalFamily = isIP(hostname);
      const records = literalFamily
        ? [{ address: hostname, family: literalFamily as 4 | 6 }]
        : await abortable(resolve(hostname), controller.signal);
      if (
        !records.length ||
        records.length > 64 ||
        records.some(
          record =>
            ![4, 6].includes(record.family) ||
            isIP(record.address) !== record.family ||
            !isPublicAiAddress(record.address),
        )
      )
        failure('unsafe_endpoint');
      let index = 0;
      agent = new Agent({
        connections: 1,
        pipelining: 1,
        maxHeaderSize: 16384,
        connect: (target, callback) => {
          if (
            target.hostname.replace(/^\[|\]$/g, '') !== hostname ||
            target.protocol !== 'https:' ||
            (target.port && target.port !== '443') ||
            controller.signal.aborted
          ) {
            callback(new AiTransportError('unsafe_endpoint'), null);
            return;
          }
          const record = records[index++ % records.length];
          let socket: TLSSocket;
          try {
            socket = dial({
              host: record.address,
              port: 443,
              servername: isIP(hostname) ? undefined : hostname,
              rejectUnauthorized: true,
              minVersion: 'TLSv1.2',
              ALPNProtocols: ['http/1.1'],
            });
          } catch {
            callback(new AiTransportError('network'), null);
            return;
          }
          let settled = false;
          const complete = (error?: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(connectTimer);
            controller.signal.removeEventListener('abort', abortSocket);
            socket.removeListener('secureConnect', onSecure);
            socket.removeListener('error', onError);
            if (error) {
              socket.destroy();
              callback(
                new AiTransportError(
                  controller.signal.aborted
                    ? 'cancelled'
                    : error instanceof AiTransportError && error.code === 'timeout'
                      ? 'timeout'
                      : 'network',
                ),
                null,
              );
            } else callback(null, socket);
          };
          const abortSocket = () => complete(new AiTransportError('cancelled'));
          const onError = (error: Error) => complete(error);
          const onSecure = () => complete();
          const connectTimer = setTimeout(
            () => complete(new AiTransportError('timeout')),
            Math.min(timeoutMs, 10000),
          );
          connectTimer.unref?.();
          socket.once('secureConnect', onSecure);
          socket.once('error', onError);
          controller.signal.addEventListener('abort', abortSocket, { once: true });
          if (controller.signal.aborted) abortSocket();
        },
      });
      // An explicit dispatcher excludes inherited proxy configuration. Redirects are always manual.
      const response = await undiciFetch(expectedUrl, {
        method: 'POST',
        headers: Object.fromEntries(headers),
        body,
        signal: controller.signal,
        redirect: 'manual',
        dispatcher: agent,
      });
      const knownKey =
        options.protocol === 'anthropic-messages'
          ? headers.get('x-api-key')!
          : headers.get('authorization')!.slice(7);
      options.onResponse?.(readAiProviderResponse(response, knownKey));
      if (response.status >= 300 && response.status < 400) failure('unsafe_endpoint');
      if (!response.ok) {
        try {
          await boundedBytes(
            response.body as unknown as ReadableStream<Uint8Array>,
            ERROR_LIMIT,
            controller.signal,
          );
        } catch {
          /* Error bodies are discarded, including oversized bodies. */
        }
        failure(statusCode(response.status));
      }
      const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
      if (contentType !== 'application/json' && contentType !== 'text/event-stream')
        failure('protocol');
      if (!response.body) failure('protocol');
      const responseLimit =
        contentType === 'text/event-stream' ? SSE_RESPONSE_LIMIT : RESPONSE_LIMIT;
      reader = response.body.getReader() as unknown as ReadableStreamDefaultReader<Uint8Array>;
      let bytes = 0;
      const stream = new ReadableStream<Uint8Array>({
        async pull(destination) {
          try {
            const { done, value } = await reader.read();
            if (controller.signal.aborted) throw safeFailure(undefined);
            if (done) {
              cleanup(false);
              destination.close();
              return;
            }
            bytes += value.byteLength;
            if (bytes > responseLimit) failure('oversize');
            destination.enqueue(value);
          } catch (error) {
            const safe = safeFailure(error);
            cleanup(true);
            destination.error(safe);
          }
        },
        cancel() {
          cleanup(true);
        },
      });
      // Undici decompresses before the reader. Drop upstream metadata and preserve only protocol data.
      return new Response(stream, {
        status: response.status,
        headers: { 'Content-Type': contentType, 'Cache-Control': 'no-store' },
      });
    } catch (error) {
      const safe = safeFailure(error);
      cleanup(true);
      throw safe;
    }
  };
}

export type AiTransportRequest = {
  baseUrl: string;
  protocol: AiProtocol;
  apiKey: string;
  body: Record<string, unknown>;
  signal?: AbortSignal;
  timeoutMs?: number;
  workspaceId?: string | null;
};
export function createAiTransport(boundaries: AiTransportBoundaries = {}) {
  return {
    async request(input: AiTransportRequest): Promise<Response> {
      const fetch = createAiFetch({
        ...boundaries,
        baseUrl: input.baseUrl,
        protocol: input.protocol,
        timeoutMs: input.timeoutMs,
        workspaceId: input.workspaceId,
      });
      const base = validateAiEndpoint(input.baseUrl);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (input.protocol === 'anthropic-messages') {
        headers['x-api-key'] = input.apiKey;
        headers['anthropic-version'] = '2023-06-01';
        if (input.workspaceId) headers['anthropic-workspace-id'] = input.workspaceId;
      } else headers.Authorization = `Bearer ${input.apiKey}`;
      return fetch(route(base, input.protocol), {
        method: 'POST',
        headers,
        body: JSON.stringify(input.body),
        signal: input.signal,
      });
    },
  };
}
export async function readAiJson(response: Response): Promise<unknown> {
  if (response.headers.get('content-type') !== 'application/json') failure('protocol');
  try {
    return await response.json();
  } catch (error) {
    if (error instanceof AiTransportError) throw error;
    failure('protocol');
  }
}
