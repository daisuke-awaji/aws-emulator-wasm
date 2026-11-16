// Copies the emulator wasm into public/ so that Vite serves and ships it.
// Source: EMULATOR_WASM, else the local build in ../.upstream.
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const here = import.meta.dirname;
const candidates = [
  process.env.EMULATOR_WASM,
  resolve(here, '../../target/aws-emulator.opt.wasm'),
  resolve(here, '../../.upstream/target/wasm32-wasip1/release/aws_emulator_wasm_host.wasm'),
].filter(Boolean);
const source = candidates.find((p) => existsSync(p));
if (!source) {
  console.error(`no emulator wasm found; set EMULATOR_WASM. Tried:\n  ${candidates.join('\n  ')}`);
  process.exit(1);
}
const target = resolve(here, '../public/aws-emulator.wasm');
mkdirSync(resolve(here, '../public'), { recursive: true });
copyFileSync(source, target);
console.log(`${source} -> public/aws-emulator.wasm (${(statSync(target).size / 1048576).toFixed(1)} MB)`);
