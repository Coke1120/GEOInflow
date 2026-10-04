import { build } from 'esbuild';
await build({
  entryPoints: ['scripts/liekan-ai-maintenance.ts'],
  outfile: 'generated/ai-maintenance.mjs',
  bundle: true,
  packages: 'external',
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: false,
});
