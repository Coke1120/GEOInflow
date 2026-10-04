import { build } from 'esbuild';
await build({
  entryPoints: ['src/liekan-worker/main.ts'],
  outfile: 'dist/liekan-worker.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  banner: {
    js: "import { createRequire } from 'node:module'; const require=createRequire(import.meta.url);",
  },
  plugins: [
    {
      name: 'prisma-runtime',
      setup(builder) {
        builder.onResolve({ filter: /^@\/generated\/prisma\/client$/ }, () => ({
          path: '../generated/prisma/client.js',
          external: true,
        }));
      },
    },
  ],
});
