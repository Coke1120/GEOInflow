// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { exportNginxPolicy } from './templates';

// Opt in with LIEKAN_TEST_NGINX=1. Uses an already installed image and exposes no host port.
it.runIf(process.env.LIEKAN_TEST_NGINX === '1')(
  'enforces exact and segment-prefix policies in an isolated real Nginx instance',
  () => {
    const directory = mkdtempSync(join(tmpdir(), 'liekan-crawler-nginx-'));
    const config = join(directory, 'nginx.conf');
    let container: string | null = null;
    const docker = (args: string[]) =>
      execFileSync('docker', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
      });
    try {
      const result = exportNginxPolicy(
        'example.com',
        {
          name: 'Boundary fixture',
          botIds: ['gptbot'],
          paths: [
            { value: '/Exact', match: 'exact' },
            { value: '/docs', match: 'prefix' },
            { value: '/cost$end', match: 'exact' },
            { value: '/price+tax', match: 'exact' },
            { value: '/a%252Fb', match: 'exact' },
            { value: '/trail/', match: 'prefix' },
          ],
          action: 'block',
          expectedAccess: 'allow',
        },
        { rateLimit: { requestsPerSecond: 1, burst: 5, dryRun: true } },
      );
      writeFileSync(
        config,
        [
          'error_log /dev/stderr; pid /tmp/nginx.pid; events {} http {',
          'access_log off;',
          result.httpContext,
          result.rateLimit.httpContext,
          'server { listen 8080; server_name example.com;',
          result.serverContext,
          result.rateLimit.serverContext,
          'location / { return 200; }',
          '}',
          '}',
        ].join('\n'),
      );
      const runOptions = [
        '--rm',
        '--pull',
        'never',
        '--network',
        'none',
        '--read-only',
        '--tmpfs',
        '/tmp',
        '--tmpfs',
        '/var/cache/nginx',
        '-v',
        `${config}:/etc/nginx/nginx.conf:ro`,
        '--entrypoint',
        'nginx',
      ];
      docker(['run', ...runOptions, 'nginx:1.28-alpine', '-t']);
      container = docker([
        'run',
        '-d',
        ...runOptions,
        'nginx:1.28-alpine',
        '-g',
        'daemon off;',
      ]).trim();
      const request = (path: string, host = 'example.com', ua = 'GPTBot') => {
        let output = '';
        try {
          output = docker([
            'exec',
            container,
            'wget',
            '-S',
            '-O',
            '/dev/null',
            '--timeout=2',
            '--header',
            `Host: ${host}`,
            '-U',
            ua,
            `http://127.0.0.1:8080${path}`,
          ]);
        } catch (error) {
          output = String((error as { stderr?: string }).stderr || '');
        }
        return Number(output.match(/HTTP\/1\.1\s+(\d{3})/)?.[1] || 0);
      };
      // Busybox wget reports successful headers on stderr, so capture both streams explicitly.
      const status = (path: string, host = 'example.com', ua = 'GPTBot') => {
        try {
          execFileSync(
            'docker',
            [
              'exec',
              container,
              'wget',
              '-q',
              '-O',
              '/dev/null',
              '--timeout=2',
              '--header',
              `Host: ${host}`,
              '-U',
              ua,
              `http://127.0.0.1:8080${path}`,
            ],
            { stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 },
          );
          return 200;
        } catch {
          return request(path, host, ua);
        }
      };
      let ready = false;
      for (let attempt = 0; attempt < 10; attempt++) {
        if (status('/health') === 200) {
          ready = true;
          break;
        }
      }
      expect(ready).toBe(true);
      for (const [path, expected] of [
        ['/Exact', 403],
        ['/exact', 200],
        ['/Exact/', 200],
        ['/Exact?x=1', 403],
        ['/docs', 403],
        ['/docs/page', 403],
        ['/docs-private', 200],
        ['/Docs', 200],
        ['/cost$end', 403],
        ['/costXend', 200],
        ['/price+tax', 403],
        ['/pricetax', 200],
        ['/a%252Fb', 403],
        ['/a%2Fb', 200],
        ['/trail/', 403],
        ['/trail', 200],
      ] as const) {
        expect(status(path), path).toBe(expected);
      }
      expect(status('/docs', 'other.example')).toBe(200);
      expect(status('/docs', 'example.com', 'OtherBot')).toBe(200);
    } finally {
      if (container) docker(['stop', '-t', '1', container]);
      unlinkSync(config);
      rmdirSync(directory);
    }
  },
  60_000,
);
