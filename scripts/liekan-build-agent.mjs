import { build } from 'esbuild';
import {
  createHash,
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  sign,
} from 'node:crypto';
import { mkdir, readFile, writeFile, access, copyFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
const version = '22.23.3';
const runtimes = {
  x64: '1084aa36196bba4c3a5e69a1ee388a6e4ff729dad09445fbcd434b28fe3c24af',
  arm64: '5ced2d48d1d7198739b7f86804de0171aefb6823b684b12341d3321afc3cb0b2',
};
const cache = resolve('outputs/agent-build-cache'),
  output = resolve('public/liekan-agent');
await mkdir(cache, { recursive: true });
await mkdir(output, { recursive: true });
let keyPath = process.env.LIEKAN_AGENT_SIGNING_KEY_FILE;
if (process.argv.includes('--development-key')) {
  keyPath = resolve('.local/agent-development-signing.pem');
  await mkdir(resolve('.local'), { recursive: true });
  try {
    await access(keyPath);
  } catch {
    await writeFile(
      keyPath,
      generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }),
      { mode: 0o600 },
    );
  }
}
if (!keyPath)
  throw new Error(
    'Configure LIEKAN_AGENT_SIGNING_KEY_FILE; local verification may use --development-key',
  );
const privateKey = createPrivateKey(await readFile(keyPath));
if (privateKey.asymmetricKeyType !== 'ed25519')
  throw new Error('An Ed25519 signing key is required');
const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
await build({
  entryPoints: ['src/liekan-agent/main.ts'],
  outfile: join(cache, 'agent.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
});
const manifest = {
  version: '1.0.0',
  protocol: 1,
  runtime: version,
  installerSha256: '',
  platforms: {},
};
for (const [arch, expected] of Object.entries(runtimes)) {
  const name = `node-v${version}-linux-${arch}.tar.gz`,
    runtime = join(cache, name);
  try {
    await access(runtime);
  } catch {
    execFileSync(
      'curl',
      [
        '-fsS',
        '--retry',
        '4',
        '--retry-delay',
        '2',
        '--retry-all-errors',
        '--proto',
        '=https',
        '--tlsv1.2',
        '--max-time',
        '300',
        `https://nodejs.org/download/release/v${version}/${name}`,
        '-o',
        runtime,
      ],
      { stdio: 'inherit' },
    );
  }
  if (
    createHash('sha256')
      .update(await readFile(runtime))
      .digest('hex') !== expected
  )
    throw new Error('Official Node runtime checksum mismatch');
  const dir = join(cache, arch);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  execFileSync('tar', [
    '-xzf',
    runtime,
    '-C',
    dir,
    '--strip-components=1',
    `node-v${version}-linux-${arch}/bin/node`,
    `node-v${version}-linux-${arch}/LICENSE`,
  ]);
  await copyFile(join(cache, 'agent.mjs'), join(dir, 'agent.mjs'));
  await copyFile('LICENSE', join(dir, 'LIEKAN-LICENSE'));
  const file = `agent-linux-${arch}.tar.gz`;
  execFileSync('tar', [
    '-czf',
    join(output, file),
    '-C',
    dir,
    'bin/node',
    'agent.mjs',
    'LICENSE',
    'LIEKAN-LICENSE',
  ]);
  manifest.platforms[arch] = {
    file,
    sha256: createHash('sha256')
      .update(await readFile(join(output, file)))
      .digest('hex'),
  };
}
const installer = (await readFile('scripts/liekan-agent/install.template.sh', 'utf8')).replace(
  '__PUBLIC_KEY__',
  String(publicKey).trim(),
);
manifest.installerSha256 = createHash('sha256').update(installer).digest('hex');
const bytes = Buffer.from(JSON.stringify(manifest));
await writeFile(join(output, 'manifest.json'), bytes);
await writeFile(join(output, 'manifest.sig'), sign(null, bytes, privateKey));
await writeFile(join(output, 'manifest.pub'), publicKey);
await writeFile(join(output, 'install.sh'), installer);
console.log('Signed collector artifacts built for Linux x64 and arm64.');
