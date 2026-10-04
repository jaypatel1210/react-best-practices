import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The lab runs on the repository's own react, react-dom and vite (no install needed).
// esbuild's automatic JSX runtime is enough; there's deliberately no Fast Refresh plugin.
export default defineConfig({
  root: dirname(fileURLToPath(import.meta.url)),
  esbuild: { jsx: 'automatic' },
  server: { host: '127.0.0.1', port: Number(process.env.LAB_PORT || 5199), strictPort: true },
  clearScreen: false,
  logLevel: 'warn',
});
