// Puts the emulator wasm at the package root (js/aws-emulator.wasm), where the package
// exports it as `aws-emulator-wasm/aws-emulator.wasm` and the Node loader finds it.
// Source: EMULATOR_WASM, else a local build.
import { copyFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const candidates = [
  process.env.EMULATOR_WASM,
  resolve(root, 'target/aws-emulator.opt.wasm'),
  resolve(root, '.upstream/target/wasm32-wasip1/release/aws_emulator_wasm_host.wasm'),
].filter(Boolean);
const source = candidates.find((p) => existsSync(p));
if (!source) {
  console.error(`no emulator wasm found; set EMULATOR_WASM. Tried:\n  ${candidates.join('\n  ')}`);
  process.exit(1);
}
const target = resolve(import.meta.dirname, '../aws-emulator.wasm');
copyFileSync(source, target);
console.log(`${source} -> js/aws-emulator.wasm (${(statSync(target).size / 1048576).toFixed(1)} MB)`);
