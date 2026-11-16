// The emulator build: start MSW (the API) and the wasm emulator in the page.
import { setupWorker } from 'msw/browser';
import { emulator, live, readyIn, reloadAndTakeOver, resetAndReload } from './emulator.js';
import { handlers } from './mocks/handlers.js';

export function start() {
  const worker = setupWorker(...handlers);
  // The emulator starts downloading at import time; MSW starts in parallel.
  const mocking = worker.start({
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
    onUnhandledFrame: 'bypass',
    quiet: true,
  });
  return {
    target: 'emulator',
    /** Resolves with { ms, persistence } once MSW and the emulator are up. */
    ready: Promise.all([mocking, readyIn]).then(([, r]) => r),
    live,
    takeOver: () => emulator.takeOver(),
    reloadAndTakeOver,
    resetAndReload,
  };
}
