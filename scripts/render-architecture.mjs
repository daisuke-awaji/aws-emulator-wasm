// Renders docs/architecture/architecture.drawio with the draw.io viewer in Chromium.
//   docs/img/architecture.drawio.png  PNG with the diagram embedded (opens in draw.io as is)
//   docs/architecture/architecture.svg
// usage: node scripts/render-architecture.mjs   (needs network access to viewer.diagrams.net)
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { crc32 } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(resolve(root, 'demo/package.json'));
const { chromium } = require('playwright-core');

const xml = readFileSync(resolve(root, 'docs/architecture/architecture.drawio'), 'utf8');
const config = { xml, toolbar: '', nav: false, border: 24, lightbox: false };
const page_html = `<!doctype html><html><head><meta charset="utf-8">
<style>body{margin:0;background:#fff}</style></head><body>
<div id="d" class="mxgraph" data-mxgraph="${JSON.stringify(config).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></div>
<script src="https://viewer.diagrams.net/js/viewer-static.min.js"></script></body></html>`;

/** Adds a tEXt chunk `mxfile` after IHDR, the way draw.io stores the diagram in a PNG. */
function embed(png, text) {
  const data = Buffer.concat([Buffer.from('mxfile\0', 'latin1'), Buffer.from(encodeURIComponent(text), 'latin1')]);
  const type = Buffer.from('tEXt', 'latin1');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])) >>> 0);
  const ihdrEnd = 8 + 4 + 4 + 13 + 4;
  return Buffer.concat([png.subarray(0, ihdrEnd), len, type, data, crc, png.subarray(ihdrEnd)]);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1900, height: 1900 }, deviceScaleFactor: 2 });
await page.setContent(page_html);
await page.waitForFunction(() => document.querySelector('#d svg'), null, { timeout: 60_000 });
const svg = page.locator('#d svg').first();
await page.waitForFunction(() => [...document.querySelectorAll('#d image')].every((i) => i.getAttribute('href') || i.getAttribute('xlink:href')));
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(500);
const png = await svg.screenshot();
writeFileSync(resolve(root, 'docs/img/architecture.drawio.png'), embed(png, xml));
const markup = await svg.evaluate((el) => {
  const copy = el.cloneNode(true);
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  copy.style.background = '#ffffff';
  return new XMLSerializer().serializeToString(copy);
});
// The viewer writes light-dark() colors; keep the light ones so the file looks the same everywhere.
writeFileSync(resolve(root, 'docs/architecture/architecture.svg'), markup.replace(/light-dark\(((?:[^(),]|\([^()]*\))+),(?:[^(),]|\([^()]*\))+\)/g, '$1'));
const box = await svg.boundingBox();
console.log(`docs/img/architecture.drawio.png (${Math.round(box.width)} x ${Math.round(box.height)} CSS px, x2), docs/architecture/architecture.svg`);
await browser.close();
