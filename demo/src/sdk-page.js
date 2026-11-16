// Runs the shared SDK scenarios against the in-browser emulator and reports the result in
// the page and on window.__sdkResult (read by the Playwright test).
import { scenarios } from 'aws-emulator-wasm/scenarios';
import { ddb, emulator, readyIn, s3, sqs } from './emulator.js';

const status = document.getElementById('status');
const rows = document.getElementById('rows');

function addRow(service, label, value, cls = '') {
  const tr = document.createElement('tr');
  for (const text of [service, label, value]) {
    const td = document.createElement('td');
    td.textContent = text;
    tr.append(td);
  }
  if (cls) tr.className = cls;
  rows.append(tr);
}

const result = { ok: false, timings: {}, readyMs: undefined, error: undefined };
try {
  result.readyMs = (await readyIn).ms;
  addRow('—', 'wasm の取得とコンパイル', `${emulator.stats.fetchCompileMs.toFixed(0)} ms`);
  addRow('—', 'インスタンス化', `${emulator.stats.instantiateMs.toFixed(0)} ms`);
  for (const [name, run] of Object.entries(scenarios)) {
    status.textContent = `${name} を実行中`;
    const timings = await run({ ddb, s3, sqs });
    result.timings[name] = timings;
    for (const { label, ms } of timings) addRow(name, label, `${ms} ms`, 'pass');
  }
  result.ok = true;
  result.skippedMs = emulator.stats.skippedMs;
  status.textContent = 'pass';
  status.className = 'pass';
} catch (error) {
  result.error = `${error?.name}: ${error?.message}`;
  status.textContent = 'fail';
  status.className = 'fail';
  document.getElementById('error').textContent = String(error?.stack ?? error);
}
window.__sdkResult = result;
