import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    setupFiles: [],
    include: ['src/lib/liekan/log-ingestion/**/*.test.ts', 'src/liekan-agent/**/*.test.ts'],
  },
});
