import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));

// Collects what the real-user reporter sends (?rum=1): POST adds records, GET returns and clears them.
const vitals = [];
const collectVitals = {
  name: 'lab-collect-vitals',
  configureServer(server) {
    server.middlewares.use('/__vitals', (request, response) => {
      if (request.method === 'POST') {
        let body = '';
        request.on('data', (chunk) => (body += chunk));
        request.on('end', () => {
          try {
            const data = JSON.parse(body);
            vitals.push(...(Array.isArray(data) ? data : [data]));
          } catch {
            // ignore malformed beacons
          }
          response.statusCode = 204;
          response.end();
        });
        return;
      }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(vitals.splice(0)));
    });
  },
};

// The lab runs on the repository's own react, react-dom, vite and web-vitals (no install needed).
// esbuild's automatic JSX runtime is enough; there's deliberately no Fast Refresh plugin.
export default defineConfig({
  root,
  esbuild: { jsx: 'automatic' },
  plugins: [collectVitals],
  // The reporter asset lives in the plugin, outside the lab's root.
  server: { host: '127.0.0.1', port: Number(process.env.LAB_PORT || 5199), strictPort: true, fs: { allow: [join(root, '..', '..')] } },
  optimizeDeps: { include: ['react', 'react-dom/client', 'web-vitals/attribution'] },
  clearScreen: false,
  logLevel: 'warn',
});
