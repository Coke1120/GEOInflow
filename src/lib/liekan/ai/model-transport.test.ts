// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import https from 'node:https';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tls from 'node:tls';
import { expect, test, vi } from 'vitest';
import { callAiModel } from './model';
import * as transport from './transport';

test('an active production SDK stream can continue past 30 seconds within the analysis deadline', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'liekan-ai-model-tls-'));
  const key = join(directory, 'key.pem'),
    cert = join(directory, 'cert.pem');
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
  const certificate = readFileSync(cert),
    sockets = new Set<Socket>(),
    timers: Array<ReturnType<typeof setTimeout>> = [];
  const chunk = (content: string, finish: string | null = null) =>
    `data: ${JSON.stringify({ id: 'fixture', created: 1, model: 'fixture', choices: [{ index: 0, delta: { content }, finish_reason: finish }] })}\n\n`;
  const server = https.createServer(
    { key: readFileSync(key), cert: certificate },
    (_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write(chunk('first '));
      timers.push(setTimeout(() => response.write(chunk('middle ')), 15000));
      timers.push(
        setTimeout(() => response.end(chunk('last', 'stop') + 'data: [DONE]\n\n'), 31000),
      );
    },
  );
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  const original = transport.createAiFetch;
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    // Only trusted DNS/dial boundaries route a validated public origin to this local TLS fixture.
    vi.spyOn(transport, 'createAiFetch').mockImplementation(options =>
      original({
        ...options,
        resolve: async () => [{ address: '93.184.216.34', family: 4 }],
        dial: options => tls.connect({ ...options, host: '127.0.0.1', port, ca: certificate }),
      }),
    );
    const text: string[] = [];
    const result = await callAiModel({
      connection: {
        provider: 'custom',
        protocol: 'openai-chat',
        base_url: 'https://api.example/v1',
        model: 'fixture',
        workspace_id: null,
        capabilities: {
          documented: { usage: false },
          keyVerified: { stream: true, structuredOutput: false },
        },
      } as any,
      apiKey: 'isolated-fixture-credential',
      system: 'Fixture.',
      prompt: 'Fixture.',
      maxOutputTokens: 2048,
      signal: AbortSignal.timeout(40000),
      stream: true,
      onText: part => text.push(part),
    });
    expect(result.text).toBe('first middle last');
    expect(text.join('')).toBe('first middle last');
    expect(result.ttftMs).not.toBeNull();
  } finally {
    vi.restoreAllMocks();
    timers.forEach(clearTimeout);
    sockets.forEach(socket => {
      socket.destroy();
    });
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(directory, { recursive: true });
  }
}, 45000);
