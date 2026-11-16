// Renders the OGP (social preview) image candidates, 1200×630, to docs/img/ogp/, and copies
// the chosen one to demo/public/og.png. Only the chosen candidate's PNG is committed.
//   node scripts/ogp.mjs            (uses Playwright from the demo workspace)
// Each design is plain HTML with the repo's own fonts, logos and AWS service icons.
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const { chromium } = createRequire(resolve(root, 'demo/package.json'))('playwright');
const out = resolve(root, 'docs/img/ogp');
mkdirSync(out, { recursive: true });

const uri = (path, type = 'image/svg+xml') => `data:${type};base64,${readFileSync(resolve(root, path)).toString('base64')}`;
const I = {
  react: uri('docs/architecture/icons/react.svg'),
  msw: uri('docs/architecture/icons/mockserviceworker.svg'),
  hono: uri('docs/architecture/icons/hono.svg'),
  wasm: uri('docs/architecture/icons/webassembly.svg'),
  ddb: uri('demo/src/assets/aws/dynamodb.svg'),
  s3: uri('demo/src/assets/aws/s3.svg'),
  sqs: uri('demo/src/assets/aws/sqs.svg'),
};
const FONTS = `
@font-face { font-family: Geist; src: url(${uri('demo/src/assets/fonts/Geist-Variable.woff2', 'font/woff2')}) format('woff2'); font-weight: 100 900; }
@font-face { font-family: 'Geist Mono'; src: url(${uri('demo/src/assets/fonts/GeistMono-Variable.woff2', 'font/woff2')}) format('woff2'); font-weight: 100 900; }
* { box-sizing: border-box; margin: 0; }
html, body { width: 1200px; height: 630px; }
body { font-family: Geist, sans-serif; -webkit-font-smoothing: antialiased; overflow: hidden; }
.mono { font-family: 'Geist Mono', monospace; }
.note { position: absolute; right: 48px; bottom: 30px; font-size: 15px; opacity: .55; }
`;
const NOTE = 'Hobby project · not affiliated with AWS';

const designs = {
  // A: light and quiet; the request path as a row of logos.
  'a-light': `
<style>
body { background: #fafafa; color: #171717; }
.grid { position: absolute; inset: 0; background-image: linear-gradient(#e5e5e5 1px, transparent 1px), linear-gradient(90deg, #e5e5e5 1px, transparent 1px); background-size: 48px 48px; mask-image: radial-gradient(ellipse at 30% 30%, #000 20%, transparent 70%); }
.wrap { position: absolute; inset: 64px 72px; display: flex; flex-direction: column; }
.repo { font-size: 26px; font-weight: 600; display: flex; align-items: center; gap: 12px; }
.repo i { width: 34px; height: 34px; border-radius: 8px; background: #171717; display: inline-block; }
h1 { font-size: 92px; line-height: 1; letter-spacing: -0.045em; font-weight: 700; margin-top: 44px; }
p { font-size: 30px; color: #525252; margin-top: 26px; line-height: 1.35; max-width: 900px; }
.path { margin-top: auto; display: flex; align-items: center; gap: 18px; }
.path img { width: 56px; height: 56px; }
.arrow { width: 44px; height: 2px; background: #a3a3a3; position: relative; }
.arrow::after { content: ''; position: absolute; right: -2px; top: -5px; border: 6px solid transparent; border-left: 8px solid #a3a3a3; }
.svcs { display: flex; gap: 10px; padding: 10px; border: 2px solid #c4b5fd; background: #f5f3ff; }
.svcs img { width: 48px; height: 48px; }
</style>
<div class="grid"></div>
<div class="wrap">
  <div class="repo"><i></i>aws-emulator-wasm</div>
  <h1>AWS in a browser tab.</h1>
  <p>DynamoDB, S3 and SQS on WebAssembly, behind the real AWS SDK v3. No server, no Docker, no AWS account.</p>
  <div class="path">
    <img src="${I.react}"><span class="arrow"></span><img src="${I.msw}"><span class="arrow"></span><img src="${I.hono}"><span class="arrow"></span>
    <img src="${I.wasm}"><span class="arrow"></span>
    <span class="svcs"><img src="${I.ddb}"><img src="${I.s3}"><img src="${I.sqs}"></span>
  </div>
</div>
<div class="note">${NOTE}</div>`,

  // B: dark, with the wasm logo at the centre of the three services.
  'b-dark': `
<style>
body { background: #0a0a0f; color: #fafafa; }
.glow { position: absolute; width: 760px; height: 760px; right: -120px; top: -80px; background: radial-gradient(circle, rgba(101,79,240,.55), transparent 62%); filter: blur(10px); }
.glow2 { position: absolute; width: 560px; height: 560px; right: 260px; bottom: -300px; background: radial-gradient(circle, rgba(201,37,209,.35), transparent 65%); }
.left { position: absolute; left: 72px; top: 72px; width: 600px; }
.repo { font-size: 24px; color: #a1a1aa; font-weight: 500; }
h1 { font-size: 84px; line-height: 1.02; letter-spacing: -0.045em; font-weight: 700; margin-top: 28px; }
h1 em { font-style: normal; background: linear-gradient(90deg, #a78bfa, #f0abfc); -webkit-background-clip: text; color: transparent; }
p { font-size: 27px; color: #a1a1aa; margin-top: 28px; line-height: 1.4; }
.orbit { position: absolute; right: 120px; top: 135px; width: 360px; height: 360px; }
.ring { position: absolute; inset: 0; border: 2px dashed rgba(167,139,250,.45); border-radius: 50%; }
.plate { position: absolute; left: 50%; top: 50%; width: 112px; height: 112px; transform: translate(-50%,-44%); background: #fff; }
.core { position: absolute; left: 50%; top: 50%; width: 132px; height: 132px; transform: translate(-50%,-50%); filter: drop-shadow(0 0 40px rgba(101,79,240,.8)); }
.sat { position: absolute; width: 76px; height: 76px; transform: translate(-50%,-50%); }
.tags { position: absolute; left: 72px; bottom: 64px; display: flex; gap: 12px; }
.tags span { font-size: 19px; padding: 8px 16px; border: 1px solid #3f3f46; color: #d4d4d8; }
.note { color: #a1a1aa; }
</style>
<div class="glow"></div><div class="glow2"></div>
<div class="left">
  <div class="repo mono">aws-emulator-wasm</div>
  <h1>AWS, <em>running in your browser</em>.</h1>
  <p>The AWS Emulator compiled to WebAssembly. Point AWS SDK v3 at it from a Web Worker.</p>
</div>
<div class="orbit">
  <div class="ring"></div>
  <div class="plate"></div><img class="core" src="${I.wasm}">
  <img class="sat" style="left:50%;top:0" src="${I.ddb}">
  <img class="sat" style="left:6.7%;top:75%" src="${I.s3}">
  <img class="sat" style="left:93.3%;top:75%" src="${I.sqs}">
</div>
<div class="tags mono"><span>DynamoDB</span><span>S3</span><span>SQS</span><span>wasm32-wasip1</span></div>
<div class="note">${NOTE}</div>`,

  // C: the code is the pitch.
  'c-code': `
<style>
body { background: linear-gradient(135deg, #f5f3ff, #fdf2f8 55%, #fff7ed); color: #171717; }
.top { position: absolute; left: 72px; top: 60px; right: 72px; display: flex; align-items: baseline; justify-content: space-between; }
h1 { font-size: 58px; letter-spacing: -0.04em; font-weight: 700; }
.repo { font-size: 22px; color: #6b7280; }
.code { position: absolute; left: 72px; right: 72px; top: 170px; background: #0f111a; color: #e5e7eb; padding: 34px 40px; font-size: 25px; line-height: 1.65; box-shadow: 0 30px 60px -20px rgba(76,29,149,.35); }
.dots { display: flex; gap: 8px; margin-bottom: 18px; }
.dots i { width: 13px; height: 13px; border-radius: 50%; background: #3f3f46; }
.k { color: #c084fc; } .s { color: #86efac; } .f { color: #93c5fd; } .c { color: #6b7280; }
.bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
.bar .dots { margin: 0; }
.icons { display: flex; gap: 10px; }
.icons img { width: 40px; height: 40px; }
.note { left: 72px; right: auto; }
</style>
<div class="top"><h1>The real AWS SDK. No AWS.</h1><span class="repo mono">aws-emulator-wasm</span></div>
<div class="code mono">
  <div class="bar"><div class="dots"><i></i><i></i><i></i></div><div class="icons"><img src="${I.ddb}"><img src="${I.s3}"><img src="${I.sqs}"></div></div>
  <div><span class="k">import</span> { createEmulator } <span class="k">from</span> <span class="s">'aws-emulator-wasm/browser'</span></div>
  <div><span class="k">const</span> emulator = <span class="f">createEmulator</span>({ wasmUrl })</div>
  <div><span class="k">const</span> ddb = <span class="k">new</span> <span class="f">DynamoDBClient</span>(emulator.<span class="f">clientConfig</span>())</div>
  <div><span class="k">await</span> ddb.<span class="f">send</span>(<span class="k">new</span> <span class="f">PutItemCommand</span>({ … }))</div>
  <div class="c">// answered by DynamoDB running as wasm, in this tab</div>
</div>
<div class="note">${NOTE}</div>`,

  // D: one app, two targets.
  'd-switch': `
<style>
body { background: #ffffff; color: #171717; }
h1 { position: absolute; left: 72px; top: 58px; font-size: 60px; letter-spacing: -0.04em; font-weight: 700; line-height: 1.05; }
.repo { position: absolute; right: 72px; top: 72px; font-size: 22px; color: #6b7280; }
.cards { position: absolute; left: 72px; right: 72px; top: 250px; display: grid; grid-template-columns: 1fr 120px 1fr; align-items: center; }
.card { border: 2px solid; padding: 28px 30px; height: 250px; display: flex; flex-direction: column; }
.mock { border-color: #7c3aed; background: #f5f3ff; }
.real { border-color: #232f3e; background: #fff7ed; }
.card b { font-size: 30px; }
.card small { font-size: 21px; color: #525252; margin-top: 6px; }
.row { margin-top: auto; display: flex; gap: 12px; align-items: center; }
.row img { width: 52px; height: 52px; }
.row .t { font-size: 20px; font-weight: 600; padding: 12px 14px; background: #ed7100; color: #fff; }
.sw { display: flex; flex-direction: column; align-items: center; gap: 10px; font-size: 16px; color: #525252; }
.toggle { width: 76px; height: 40px; border-radius: 20px; background: #171717; position: relative; }
.toggle::after { content: ''; position: absolute; width: 30px; height: 30px; border-radius: 50%; background: #fff; top: 5px; right: 6px; }
</style>
<h1>Mock it in the browser.<br>Ship it to AWS.</h1>
<div class="repo mono">aws-emulator-wasm</div>
<div class="cards">
  <div class="card mock"><b>In the browser</b><small>MSW + AWS Emulator on wasm</small>
    <div class="row"><img src="${I.msw}"><img src="${I.hono}"><img src="${I.wasm}"><img src="${I.ddb}"><img src="${I.s3}"><img src="${I.sqs}"></div></div>
  <div class="sw"><div class="toggle"></div><span class="mono">VITE_API_URL</span></div>
  <div class="card real"><b>On AWS</b><small>the same Hono API on Lambda</small>
    <div class="row"><img src="${I.hono}"><img src="${I.ddb}"><img src="${I.s3}"><img src="${I.sqs}"></div></div>
</div>
<div class="note">${NOTE}</div>`,
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
for (const [name, body] of Object.entries(designs)) {
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${FONTS}</style></head><body>${body}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(out, `ogp-${name}.png`) });
  console.log(`docs/img/ogp/ogp-${name}.png`);
}
await browser.close();

// The design in use: served by the demo as /og.png (see demo/index.html).
const CHOSEN = 'a-light';
copyFileSync(resolve(out, `ogp-${CHOSEN}.png`), resolve(root, 'demo/public/og.png'));
console.log(`demo/public/og.png <- ogp-${CHOSEN}.png`);
