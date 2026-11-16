// The emulator build. Nothing heavy loads with the page: the wasm (about 9 MB compressed),
// the AWS SDK and MSW come in only when the user starts the emulator, so following a link
// on a phone costs the page itself and no more. A browser that started it once starts it by
// itself on later visits (the wasm is then usually in the HTTP cache).

const AUTOSTART = 'aws-emulator-demo-autostart';

const remembered = () => {
  try {
    return localStorage.getItem(AUTOSTART) === '1';
  } catch {
    return false;
  }
};
const remember = () => {
  try {
    localStorage.setItem(AUTOSTART, '1');
  } catch {
    // Not remembered; the button shows again next time.
  }
};

export function start() {
  // What the page reads before and after the emulator exists (lock, saves): emulator.js's
  // own `live`, forwarded once it is loaded.
  const listeners = new Set();
  const live = {
    lock: undefined,
    lastSave: undefined,
    saveError: undefined,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  const changed = () => {
    for (const fn of listeners) fn();
  };

  let emu; // emulator.js, once loaded
  let markReady;
  let markFailed;
  const ready = new Promise((resolve, reject) => {
    markReady = resolve;
    markFailed = reject;
  });
  ready.catch(() => {});

  let booting;
  /** Downloads MSW, the SDK and the wasm, and starts them. Safe to call more than once. */
  function boot() {
    booting ??= (async () => {
      remember();
      const [{ setupWorker }, { handlers }, module] = await Promise.all([
        import('msw/browser'),
        import('./mocks/handlers.js'),
        import('./emulator.js'),
      ]);
      emu = module;
      const sync = () => {
        Object.assign(live, { lock: emu.live.lock, lastSave: emu.live.lastSave, saveError: emu.live.saveError });
        changed();
      };
      emu.live.subscribe(sync);
      sync();
      const worker = setupWorker(...handlers);
      const mocking = worker.start({
        serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
        onUnhandledFrame: 'bypass',
        quiet: true,
      });
      const [, result] = await Promise.all([mocking, emu.readyIn]);
      return result;
    })().then(markReady, markFailed);
    return booting;
  }

  const autostart = remembered();
  if (autostart) boot();

  return {
    target: 'emulator',
    /** True until the emulator is started (no download has happened yet). */
    idle: !autostart,
    boot,
    /** Resolves with { ms, persistence } once MSW and the emulator are up. */
    ready,
    live,
    takeOver: () => emu?.emulator.takeOver(),
    reloadAndTakeOver: () => emu?.reloadAndTakeOver(),
    resetAndReload: () => emu?.resetAndReload(),
  };
}
