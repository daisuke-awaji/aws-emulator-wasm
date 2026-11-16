// Runs the shared SDK scenarios against the in-browser emulator and reports the result in
// the page and on window.__sdkResult (read by the Playwright test).
import { scenarios } from 'aws-emulator-wasm/scenarios';
import { ddb, emulator, readyIn, s3, sqs } from './emulator.js';
import { LANGS, onLangChange, setDocumentKeys, setLang, t } from './i18n.js';

const status = document.getElementById('status');
const rows = document.getElementById('rows');
const langGroup = document.getElementById('lang');

setDocumentKeys({ title: 'sdk.doc.title' });

// Rows keep their message key, so a language switch rewrites them too.
let statusText = ['status.loading'];
const labelled = []; // [td, key]
function render() {
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
  document.getElementById('lead').replaceChildren(
    ...t('sdk.lead', (text) => Object.assign(document.createElement('code'), { textContent: text })),
  );
  langGroup.setAttribute('aria-label', t('nav.language'));
  langGroup.replaceChildren(
    ...LANGS.map((l) => {
      const button = Object.assign(document.createElement('button'), { type: 'button', lang: l, textContent: { en: 'EN', ja: '日本語' }[l] });
      button.setAttribute('aria-pressed', String(document.documentElement.lang === l));
      button.onclick = () => setLang(l);
      return button;
    }),
  );
  status.textContent = t(...statusText);
  for (const [td, key] of labelled) td.textContent = t(key);
}
onLangChange(render);

const setStatus = (...label) => {
  statusText = label;
  status.textContent = t(...label);
};

function addRow(service, label, value, cls = '', key) {
  const tr = document.createElement('tr');
  for (const text of [service, label, value]) {
    const td = document.createElement('td');
    td.textContent = text;
    tr.append(td);
  }
  if (key) labelled.push([tr.children[1], key]);
  if (cls) tr.className = cls;
  rows.append(tr);
}

const result = { ok: false, timings: {}, readyMs: undefined, error: undefined };
try {
  result.readyMs = (await readyIn).ms;
  addRow('—', t('sdk.fetchCompile'), `${emulator.stats.fetchCompileMs.toFixed(0)} ms`, '', 'sdk.fetchCompile');
  addRow('—', t('sdk.instantiate'), `${emulator.stats.instantiateMs.toFixed(0)} ms`, '', 'sdk.instantiate');
  for (const [name, run] of Object.entries(scenarios)) {
    setStatus('sdk.running', name);
    const timings = await run({ ddb, s3, sqs });
    result.timings[name] = timings;
    for (const { label, ms } of timings) addRow(name, label, `${ms} ms`, 'pass');
  }
  result.ok = true;
  result.skippedMs = emulator.stats.skippedMs;
  setStatus('pass');
  status.className = 'pass';
} catch (error) {
  result.error = `${error?.name}: ${error?.message}`;
  setStatus('fail');
  status.className = 'fail';
  document.getElementById('error').textContent = String(error?.stack ?? error);
}
window.__sdkResult = result;
