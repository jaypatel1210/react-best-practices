import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests for the render-audit scripts. The browser end-to-end check lives in tests/e2e.mjs
// because it needs Chrome and a local dev server.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    environment: 'node',
    include: ['tests/**/*.test.mjs'],
  },
});
