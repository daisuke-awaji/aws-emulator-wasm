import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { msw } from 'msw/vite';
import { defineConfig, loadEnv } from 'vite';

// BASE_PATH: where the site is served from, e.g. /aws-emulator-wasm/ on GitHub Pages.
// VITE_API_URL (e.g. in .env.aws.local, `vite build --mode aws`): build the page against
// the deployed API instead of the emulator (src/target.js). The SDK test page needs the
// emulator, so that build leaves it out.
export default defineConfig(({ mode }) => {
  const aws = Boolean(loadEnv(mode, import.meta.dirname, 'VITE_').VITE_API_URL);
  return {
  base: process.env.BASE_PATH ?? '/',
  // worker-only: serve mockServiceWorker.js in dev and emit it next to the build.
  plugins: [react(), ...(aws ? [] : [msw({ mode: 'worker-only' })])],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    // React, MSW and three SDK clients in one page chunk.
    chunkSizeWarningLimit: 1024,
    rollupOptions: {
      input: {
        todo: resolve(import.meta.dirname, 'index.html'),
        ...(aws ? {} : { sdk: resolve(import.meta.dirname, 'sdk.html') }),
      },
    },
  },
  preview: { port: 4173, strictPort: true },
  };
});
