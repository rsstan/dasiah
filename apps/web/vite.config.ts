// Dev server proxies /api to the gateway, so the browser talks to one origin (the refresh cookie
// is scoped to /api/v1/auth and no CORS preflight is needed). In production Caddy does the same.
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env['GATEWAY_URL'] ?? 'http://localhost:8080', changeOrigin: false } },
  },
  build: { sourcemap: true, chunkSizeWarningLimit: 1600 },
});
