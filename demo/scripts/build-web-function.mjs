// Builds the Lambda Web Function package into dist-web-function/:
//   index.js      api/index.js with its dependencies (Hono, @hono/node-server, AWS SDK v3)
//   package.json  { "type": "module" }, so Node loads index.js as an ES module
// Zip the directory's contents (index.js at the root) and upload it to S3; see api/README.md.
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const out = resolve(import.meta.dirname, '../dist-web-function');
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
await build({
  entryPoints: [resolve(import.meta.dirname, '../api/index.js')],
  outfile: resolve(out, 'index.js'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  minify: true,
  // Some SDK dependencies still call require(); give the ES module one.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'warning',
});
writeFileSync(resolve(out, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`);
console.log(`dist-web-function/index.js (${(statSync(resolve(out, 'index.js')).size / 1024).toFixed(0)} KiB), package.json`);
