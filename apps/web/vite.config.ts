// Dev server proxies /api to the gateway, so the browser talks to one origin (the refresh cookie
// is scoped to /api/v1/auth and no CORS preflight is needed). In production Caddy does the same.
// ANALYZE=1 (pnpm web:analyze) also writes a bundle report: dist/stats.html (treemap) and
// dist/stats.json (raw data, summarised in docs/evidence/frontend-performance.md).
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig, type PluginOption } from 'vite';

const analyze = process.env['ANALYZE'] === '1';
const report: PluginOption[] = analyze
  ? [
      visualizer({ filename: 'dist/stats.html', template: 'treemap', gzipSize: true }),
      visualizer({ filename: 'dist/stats.json', template: 'raw-data', gzipSize: true }),
    ]
  : [];

export default defineConfig({
  plugins: [react(), ...report],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env['GATEWAY_URL'] ?? 'http://localhost:8080', changeOrigin: false } },
  },
  build: { sourcemap: true, chunkSizeWarningLimit: 1600 },
});
