// A page from an earlier deploy asks for chunks the current deploy no longer has.
//
// GitHub Pages lets a browser keep index.html for ten minutes (max-age=600), and a tab can
// sit on the page much longer before "Download and start". The chunks have content hashes
// and each deploy replaces the whole site, so the old page's import() then gets a 404
// (Safari: "Importing a module script failed."; Chrome: "Failed to fetch dynamically
// imported module"). Vite reports these as vite:preloadError; the page reloads once to get
// the current index.html, and shows the error if the reload did not help.
const KEY = 'aws-emulator-demo-reloaded';
const WINDOW_MS = 60_000;

window.addEventListener('vite:preloadError', () => {
  try {
    const last = Number(sessionStorage.getItem(KEY)) || 0;
    if (Date.now() - last < WINDOW_MS) return; // Reloaded just now and still failing.
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return; // Without sessionStorage a reload could repeat; show the error instead.
  }
  // The import still rejects, so the error may show until the reload replaces the page.
  location.reload();
});
