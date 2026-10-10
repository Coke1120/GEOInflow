import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getLogCapabilities } from './capabilities';
import { logPublicOrigin } from '../contracts/installation';
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  manifest: vi.fn(),
  docker: vi.fn(),
  publicUrl: vi.fn(),
}));
vi.mock('../upstream/server', () => ({ query: mocks.query }));
vi.mock('./assets', () => ({
  readAgentManifest: mocks.manifest,
  readDockerManifest: mocks.docker,
}));
vi.mock('./service', () => ({ publicUrl: mocks.publicUrl }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue([{ queue: true, worker: true }]);
  mocks.manifest.mockResolvedValue({});
  mocks.docker.mockResolvedValue({});
  mocks.publicUrl.mockReturnValue('https://stats.example.com');
  vi.stubEnv('CLOUDFLARE_OAUTH_CLIENT_ID', 'private-client');
  vi.stubEnv('CLOUDFLARE_OAUTH_CLIENT_SECRET', 'private-secret');
  vi.stubEnv('LIEKAN_LOG_CREDENTIALS_KEY', Buffer.alloc(32, 7).toString('base64'));
});
it('allows Docker installation independently of systemd archives', async () => {
  mocks.manifest.mockRejectedValue(new Error('missing Linux archive'));
  const result = await getLogCapabilities();
  expect(result.server).toMatchObject({
    available: true,
    runtimes: { docker: true, systemd: false },
  });
  mocks.docker.mockRejectedValue(new Error('invalid Docker archive'));
  expect((await getLogCapabilities()).server.available).toBe(false);
});
afterEach(() => vi.unstubAllEnvs());
it('reports all prerequisites even when the public address is missing and never exposes secrets', async () => {
  mocks.publicUrl.mockImplementation(() => {
    throw new Error('missing');
  });
  vi.stubEnv('CLOUDFLARE_OAUTH_CLIENT_SECRET', '');
  const result = await getLogCapabilities();
  expect(result.server).toMatchObject({
    available: false,
    publicUrl: null,
    checks: [
      { id: 'public-url', state: 'missing' },
      { id: 'queue', state: 'ready' },
      { id: 'worker', state: 'ready' },
      { id: 'agent-package', state: 'ready' },
    ],
  });
  expect(result.cloudflare).toMatchObject({
    checks: expect.arrayContaining([
      { id: 'cloudflare-oauth', state: 'missing' },
      { id: 'credentials-key', state: 'ready' },
    ]),
  });
  expect(JSON.stringify(result)).not.toMatch(/private-client|private-secret|BwcHB/);
});
it('distinguishes unreadable worker state from missing configuration', async () => {
  mocks.query.mockRejectedValue(new Error('database unavailable'));
  const result = await getLogCapabilities();
  expect(result.server).toMatchObject({
    available: false,
    checks: expect.arrayContaining([
      { id: 'queue', state: 'unverified' },
      { id: 'worker', state: 'unverified' },
    ]),
  });
});
it('keeps server installation independent of Cloudflare credentials', async () => {
  vi.stubEnv('LIEKAN_LOG_CREDENTIALS_KEY', '');
  const result = await getLogCapabilities();
  expect(result.server.available).toBe(true);
  expect(result.cloudflare.available).toBe(false);
});
it.each([
  'http://stats.example.com',
  'https://localhost',
  'https://127.0.0.1',
  'https://stats.internal',
  'https://name:secret@stats.example.com',
  'https://stats.example.com/path',
  'https://stats.example.com/?q=a',
  'https://stats.example.com/#fragment',
  'https://stats.example.com/\nENV=value',
])('rejects unsafe public root %s in both configuration and receiver validation', value => {
  expect(logPublicOrigin(value)).toBeNull();
});
it('normalizes valid HTTPS roots', () => {
  expect(logPublicOrigin('https://STATS.example.com/')).toBe('https://stats.example.com');
});
