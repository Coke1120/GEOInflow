// @vitest-environment node

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import https from 'node:https';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import tls, { type ConnectionOptions } from 'node:tls';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAiFetch, readAiJson } from './transport';

describe('secured AI fetch public seam', () => {
  it('blocks unsafe endpoints before DNS or dialing can send credentials', async () => {
    for (const baseUrl of [
      'http://api.example/v1',
      'https://localhost/v1',
      'https://127.0.0.1/v1',
      'https://[::ffff:127.0.0.1]/v1',
      'https://api.example:8443/v1',
      'https://key@api.example/v1',
      'https://api.example/v1?q=1',
    ]) {
      expect(() => createAiFetch({ baseUrl, protocol: 'openai-chat' })).toThrow(/公共 HTTPS/);
    }
    const fetch = createAiFetch({
      baseUrl: 'https://api.example/v1',
      protocol: 'openai-chat',
      resolve: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ],
    });
    await expect(
      fetch('https://api.example/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
        body: '{}',
      }),
    ).rejects.toMatchObject({ code: 'unsafe_endpoint' });
  });
});

let certificate: Buffer;
let privateKey: Buffer;
let certificateDirectory: string;
beforeAll(() => {
  certificateDirectory = mkdtempSync(path.join(tmpdir(), 'liekan-ai-tls-'));
  const key = path.join(certificateDirectory, 'key.pem');
  const cert = path.join(certificateDirectory, 'cert.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '1',
      '-subj',
      '/CN=api.example',
      '-addext',
      'subjectAltName=DNS:api.example',
    ],
    { stdio: 'ignore' },
  );
  certificate = readFileSync(cert);
  privateKey = readFileSync(key);
});
afterAll(() => {
  if (certificateDirectory) rmSync(certificateDirectory, { recursive: true });
});

async function tlsFixture(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  test: (
    dial: (options: ConnectionOptions) => tls.TLSSocket,
    pins: ConnectionOptions[],
  ) => Promise<void>,
) {
  const server = https.createServer({ cert: certificate, key: privateKey }, handler);
  const sockets = new Set<Socket>();
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const pins: ConnectionOptions[] = [];
  const dial = (options: ConnectionOptions) => {
    pins.push(options);
    // Trusted system boundary redirects the actual dial to this fixture, preserving TLS identity.
    return tls.connect({ ...options, host: '127.0.0.1', port, ca: certificate });
  };
  try {
    await test(dial, pins);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
const fetchOptions = { baseUrl: 'https://api.example/v1', protocol: 'openai-chat' as const };
const requestUrl = 'https://api.example/v1/chat/completions';
const publicRecords = async () => [{ address: '93.184.216.34', family: 4 as const }];
const requestOptions = {
  method: 'POST',
  headers: { Authorization: 'Bearer private-test-credential', 'Content-Type': 'application/json' },
  body: '{"model":"fixture","messages":[]}',
};

describe('pinned real HTTPS transport through trusted system boundaries', () => {
  it('pins validated DNS records and original TLS identity while excluding custom headers and proxy inheritance', async () => {
    let received: IncomingMessage;
    let resolutions = 0;
    const priorProxy = process.env.HTTPS_PROXY;
    process.env.HTTPS_PROXY = 'http://127.0.0.1:1';
    try {
      await tlsFixture(
        (request, response) => {
          received = request;
          response.writeHead(200, {
            'Content-Type': 'application/json',
            'x-provider-secret': 'echo-key',
          });
          response.end('{"ok":true}');
        },
        async (dial, pins) => {
          const fetch = createAiFetch({
            ...fetchOptions,
            dial,
            resolve: async () =>
              ++resolutions === 1 ? publicRecords() : [{ address: '10.0.0.1', family: 4 }],
          });
          const response = await fetch(requestUrl, {
            ...requestOptions,
            headers: {
              ...requestOptions.headers,
              Cookie: 'cookie-secret',
              'x-arbitrary': 'injected',
            },
          });
          expect(await readAiJson(response)).toEqual({ ok: true });
          expect(response.headers.has('x-provider-secret')).toBe(false);
          expect(pins).toMatchObject([
            {
              host: '93.184.216.34',
              port: 443,
              servername: 'api.example',
              rejectUnauthorized: true,
            },
          ]);
          expect((received.socket as tls.TLSSocket).servername).toBe('api.example');
          expect(received.headers.host).toBe('api.example');
          expect(received.headers.cookie).toBeUndefined();
          expect(received.headers['x-arbitrary']).toBeUndefined();
          expect(resolutions).toBe(1);
        },
      );
    } finally {
      if (priorProxy === undefined) delete process.env.HTTPS_PROXY;
      else process.env.HTTPS_PROXY = priorProxy;
    }
  });
  it('blocks alternate origins, route changes and redirects', async () => {
    await tlsFixture(
      (_request, response) => {
        response.writeHead(302, { Location: 'https://127.0.0.1/admin' });
        response.end();
      },
      async (dial, pins) => {
        const fetch = createAiFetch({ ...fetchOptions, dial, resolve: publicRecords });
        for (const url of [
          'https://other.example/v1/chat/completions',
          'https://api.example/v1/models',
          `${requestUrl}?key=private-test-credential`,
          'https://api.example/v1/messages',
        ])
          await expect(fetch(url, requestOptions)).rejects.toMatchObject({
            code: 'unsafe_endpoint',
          });
        expect(pins).toHaveLength(0);
        await expect(fetch(requestUrl, requestOptions)).rejects.toMatchObject({
          code: 'unsafe_endpoint',
        });
        expect(pins).toHaveLength(1);
      },
    );
  });
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '169.254.169.254',
    '100.64.1.1',
    '192.0.2.1',
    '198.18.0.1',
    '224.0.0.1',
    '240.0.0.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    '::ffff:127.0.0.1',
  ])('rejects DNS resolution to reserved address %s', async address => {
    const fetch = createAiFetch({
      ...fetchOptions,
      resolve: async () => [{ address, family: address.includes(':') ? 6 : 4 }],
    });
    await expect(fetch(requestUrl, requestOptions)).rejects.toMatchObject({
      code: 'unsafe_endpoint',
    });
  });
  it('checks every DNS record before each request after DNS rebinding', async () => {
    await tlsFixture(
      (_request, response) => {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end('{}');
      },
      async (dial, pins) => {
        let resolutions = 0;
        const fetch = createAiFetch({
          ...fetchOptions,
          dial,
          resolve: async () =>
            ++resolutions === 1 ? publicRecords() : [{ address: '10.0.0.1', family: 4 }],
        });
        expect(await readAiJson(await fetch(requestUrl, requestOptions))).toEqual({});
        await expect(fetch(requestUrl, requestOptions)).rejects.toMatchObject({
          code: 'unsafe_endpoint',
        });
        expect(pins).toHaveLength(1);
      },
    );
  });
  it('rejects a TLS endpoint whose certificate does not match the configured hostname', async () => {
    await tlsFixture(
      (_request, response) => {
        response.end('{}');
      },
      async dial => {
        const fetch = createAiFetch({
          baseUrl: 'https://other.example/v1',
          protocol: 'openai-chat',
          dial,
          resolve: publicRecords,
        });
        await expect(
          fetch('https://other.example/v1/chat/completions', requestOptions),
        ).rejects.toMatchObject({ code: 'network' });
      },
    );
  });
  it('limits decompressed output even when a small compressed response expands past the bound', async () => {
    const payload = gzipSync(JSON.stringify({ content: 'x'.repeat(512 * 1024) }));
    expect(payload.length).toBeLessThan(2048);
    await tlsFixture(
      (_request, response) => {
        response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' });
        response.end(payload);
      },
      async dial => {
        const fetch = createAiFetch({ ...fetchOptions, dial, resolve: publicRecords });
        await expect(readAiJson(await fetch(requestUrl, requestOptions))).rejects.toMatchObject({
          code: 'oversize',
        });
      },
    );
  });
  it('cancels a streaming response and closes the provider socket', async () => {
    let closed: Promise<void>;
    await tlsFixture(
      (request, response) => {
        closed = new Promise(resolve => request.socket.once('close', () => resolve()));
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.write('data: {"text":"first"}\n\n');
      },
      async dial => {
        const abort = new AbortController();
        const fetch = createAiFetch({ ...fetchOptions, dial, resolve: publicRecords });
        const response = await fetch(requestUrl, { ...requestOptions, signal: abort.signal });
        const reader = response.body.getReader();
        expect(new TextDecoder().decode((await reader.read()).value)).toContain('first');
        const pending = reader.read();
        abort.abort();
        await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
        await Promise.race([
          closed,
          new Promise((_resolve, reject) =>
            setTimeout(() => reject(new Error('Socket remained open')), 1000),
          ),
        ]);
      },
    );
  });
  it.each([
    [401, 'credentials'],
    [403, 'credentials'],
    [404, 'model'],
    [429, 'busy'],
    [502, 'upstream'],
  ])('sanitizes provider failure %s including echoed credentials', async (status, code) => {
    await tlsFixture(
      (_request, response) => {
        response.writeHead(Number(status), { 'Content-Type': 'application/json' });
        response.end('{"error":"private-test-credential"}');
      },
      async dial => {
        const fetch = createAiFetch({ ...fetchOptions, dial, resolve: publicRecords });
        try {
          await fetch(requestUrl, requestOptions);
          throw new Error('Expected safe failure');
        } catch (error) {
          expect(error).toMatchObject({ code });
          expect(String(error)).not.toContain('private-test-credential');
          expect(JSON.stringify(error)).not.toContain('private-test-credential');
        }
      },
    );
  });
  it('rejects non-JSON or non-SSE response content and oversized input', async () => {
    await tlsFixture(
      (_request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end('<html>provider debug</html>');
      },
      async (dial, pins) => {
        const fetch = createAiFetch({ ...fetchOptions, dial, resolve: publicRecords });
        await expect(
          fetch(requestUrl, {
            ...requestOptions,
            body: JSON.stringify({ text: 'x'.repeat(64 * 1024) }),
          }),
        ).rejects.toMatchObject({ code: 'oversize' });
        expect(pins).toHaveLength(0);
        await expect(fetch(requestUrl, requestOptions)).rejects.toMatchObject({ code: 'protocol' });
      },
    );
  });
  it('applies a bounded timeout to a provider that never sends response headers', async () => {
    await tlsFixture(
      () => {},
      async dial => {
        const fetch = createAiFetch({
          ...fetchOptions,
          dial,
          resolve: publicRecords,
          timeoutMs: 100,
        });
        await expect(fetch(requestUrl, requestOptions)).rejects.toMatchObject({ code: 'timeout' });
      },
    );
  });
});

describe('canonical SDK URLs and fixed Anthropic workspace headers', () => {
  it('calls accepted uppercase and explicit default-port SDK URLs', async () => {
    await tlsFixture(
      (_request, response) => {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end('{}');
      },
      async dial => {
        const fetch = createAiFetch({
          ...fetchOptions,
          baseUrl: 'https://API.EXAMPLE:443/v1/',
          dial,
          resolve: publicRecords,
        });
        expect(
          await readAiJson(
            await fetch('https://API.EXAMPLE:443/v1/chat/completions', requestOptions),
          ),
        ).toEqual({});
      },
    );
  });
  it('requires the configured workspace header and forwards its fixed name to Anthropic', async () => {
    let received: IncomingMessage;
    await tlsFixture(
      (request, response) => {
        received = request;
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end('{}');
      },
      async (dial, pins) => {
        const fetch = createAiFetch({
          ...fetchOptions,
          protocol: 'anthropic-messages',
          workspaceId: 'wrkspc_A1-b2',
          dial,
          resolve: publicRecords,
        });
        const headers = {
          'Content-Type': 'application/json',
          'x-api-key': 'secret',
          'anthropic-version': '2023-06-01',
        };
        for (const extra of [{}, { 'anthropic-workspace-id': 'wrkspc_other' }])
          await expect(
            fetch('https://api.example/v1/messages', {
              ...requestOptions,
              headers: { ...headers, ...extra },
            }),
          ).rejects.toMatchObject({ code: 'invalid_request' });
        expect(pins).toHaveLength(0);
        expect(
          await readAiJson(
            await fetch('https://api.example/v1/messages', {
              ...requestOptions,
              headers: {
                ...headers,
                'anthropic-workspace-id': 'wrkspc_A1-b2',
                'x-custom': 'ignored',
              },
            }),
          ),
        ).toEqual({});
        expect(received.headers['anthropic-workspace-id']).toBe('wrkspc_A1-b2');
        expect(received.headers['x-custom']).toBeUndefined();
      },
    );
  });
  it('rejects workspace configuration for Chat and invalid or unsolicited workspace headers', async () => {
    expect(() => createAiFetch({ ...fetchOptions, workspaceId: 'wrkspc_A1' })).toThrow();
    expect(() =>
      createAiFetch({ ...fetchOptions, protocol: 'anthropic-messages', workspaceId: 'bad' }),
    ).toThrow();
    const fetch = createAiFetch({ ...fetchOptions, protocol: 'anthropic-messages' });
    await expect(
      fetch('https://api.example/v1/messages', {
        ...requestOptions,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'secret',
          'anthropic-version': '2023-06-01',
          'anthropic-workspace-id': 'wrkspc_unrequested',
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });
  it.each([
    '/v1/%2e%2e/chat/completions',
    '/v1/.%2E/chat/completions',
    '/v1/%252e%252e/chat/completions',
    '/v1//chat/completions',
    '/v1/chat/completions/',
  ])('rejects raw route ambiguity %s', async pathname => {
    const fetch = createAiFetch({ ...fetchOptions });
    await expect(fetch(`https://api.example${pathname}`, requestOptions)).rejects.toMatchObject({
      code: 'unsafe_endpoint',
    });
  });
});

it('reports only safe provider status and identifier before an HTTP failure', async () => {
  await tlsFixture(
    (_request, response) => {
      response.writeHead(401, {
        'content-type': 'application/json',
        'x-request-id': 'req-isolated-401',
      });
      response.end('{"error":"discarded"}');
    },
    async dial => {
      const reports: unknown[] = [];
      const secured = createAiFetch({
        ...fetchOptions,
        dial,
        resolve: publicRecords,
        onResponse: value => {
          reports.push(value);
        },
      });
      await expect(secured(requestUrl, requestOptions)).rejects.toMatchObject({
        code: 'credentials',
      });
      expect(reports).toEqual([{ status: 401, requestId: 'req-isolated-401' }]);
    },
  );
});
