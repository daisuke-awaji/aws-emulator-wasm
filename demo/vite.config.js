import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { msw } from 'msw/vite';
import { defineConfig } from 'vite';

// BASE_PATH: where the site is served from, e.g. /aws-emulator-wasm/ on GitHub Pages.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  // worker-only: serve mockServiceWorker.js in dev and emit it next to the build.
  plugins: [react(), msw({ mode: 'worker-only' })],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    // React, MSW and three SDK clients in one page chunk.
    chunkSizeWarningLimit: 1024,
    rollupOptions: {
      input: {
        todo: resolve(import.meta.dirname, 'index.html'),
        sdk: resolve(import.meta.dirname, 'sdk.html'),
      },
    },
  },
  preview: { port: 4173, strictPort: true },
});
