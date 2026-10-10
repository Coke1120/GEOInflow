import { beforeEach, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { dockerDeployment } from './docker-deployment';
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('node:fs/promises', () => ({ readFile: mocks.read, default: { readFile: mocks.read } }));
vi.mock('./assets', () => ({
  readDockerManifest: async () => ({
    version: '1.0.0',
    docker: { zipFile: 'agent-docker.zip', installerSha256: 'a'.repeat(64) },
  }),
}));
vi.mock('./service', () => ({ publicUrl: () => 'https://stats.example.com' }));
beforeEach(async () => {
  const zip = new JSZip();
  zip.file('install.sh', 'verified installer');
  zip.file('Dockerfile', 'pinned runtime');
  mocks.read.mockResolvedValue(await zip.generateAsync({ type: 'nodebuffer' }));
});
it('personalizes a deployable package without credentials and preserves bundled files', async () => {
  const id = '95c63874-b7d6-4370-b7fa-46f9d4624dc3';
  const result = await dockerDeployment(id);
  const zip = await JSZip.loadAsync(Buffer.from(result.archive, 'base64'));
  expect(await zip.file('start.sh')!.async('string')).toContain(`--website '${id}'`);
  expect(await zip.file('start.sh')!.async('string')).toContain(
    "--url 'https://stats.example.com'",
  );
  expect(await zip.file('install.sh')!.async('string')).toBe('verified installer');
  expect(await zip.file('README.txt')!.async('string')).toContain('首次采集');
  expect(await zip.file('start.sh')!.async('string')).not.toMatch(/--code|token|password/);
  expect(result.command).toContain('install-docker.sh');
  expect(result.command).not.toContain('--code');
});
