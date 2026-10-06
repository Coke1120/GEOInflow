import { readFile, stat } from 'node:fs/promises';
import { createHash, verify } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';
const artifact = z.strictObject({
  file: z.string().regex(/^agent-linux-(x64|arm64)\.tar\.gz$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const manifestSchema = z.strictObject({
  version: z.literal('1.0.0'),
  protocol: z.literal(1),
  runtime: z.literal('22.23.3'),
  installerSha256: z.string().regex(/^[a-f0-9]{64}$/),
  platforms: z.strictObject({ x64: artifact, arm64: artifact }),
});
export async function readAgentManifest() {
  const directory = resolve('public/liekan-agent');
  const [bytes, signature, key, installer] = await Promise.all(
    ['manifest.json', 'manifest.sig', 'manifest.pub', 'install.sh'].map(name =>
      readFile(resolve(directory, name)),
    ),
  );
  if (bytes.length > 16384 || !verify(null, bytes, key, signature))
    throw new Error('安装资产签名无效');
  const manifest = manifestSchema.parse(JSON.parse(bytes.toString('utf8')));
  if (createHash('sha256').update(installer).digest('hex') !== manifest.installerSha256)
    throw new Error('安装引导校验失败');
  for (const asset of Object.values(manifest.platforms))
    if (!(await stat(resolve(directory, asset.file))).isFile()) throw new Error('安装资产不完整');
  return manifest;
}
