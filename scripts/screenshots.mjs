// Screenshot the styleguide and the real app flow at phone and desktop widths.
// Usage: python3 -m http.server 8811 &  node scripts/screenshots.mjs [outDir] [baseUrl]
// nomi has zero dependencies, so Playwright is resolved from (in order) NOMI_PLAYWRIGHT,
// ./node_modules, or a sibling project that already has it (../redsgn).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ?? path.join(root, 'docs/design');
const base = process.argv[3] ?? 'http://localhost:8811';
mkdirSync(out, { recursive: true });

const req = createRequire(import.meta.url);
const candidates = [process.env.NOMI_PLAYWRIGHT, path.join(root, 'node_modules'), path.join(root, '../redsgn/node_modules')].filter(Boolean);
let chromium;
for (const dir of candidates) {
  try { ({ chromium } = req(req.resolve('playwright', { paths: [dir] }))); break; } catch {}
}
if (!chromium) { console.error('Playwright not found. Run `npm i --no-save playwright` or set NOMI_PLAYWRIGHT.'); process.exit(1); }

// Fake photos so every view has real colour in it. Drawn in the page, passed to the file input.
async function samplePhotos(page) {
  const specs = [
    { name: 'sunset-coast.jpg', w: 1600, h: 1067, sky: ['#2b2d6e', '#d9604a', '#f6b45a'], sea: '#1d3b52' },
    { name: 'forest-path.jpg', w: 1067, h: 1600, sky: ['#9fc4b2', '#d8e6cf', '#f1f0d4'], sea: '#2f5a3a' },
    { name: 'city-night.jpg', w: 1600, h: 900, sky: ['#0d0f2b', '#3b2a68', '#c4527d'], sea: '#14122c' },
    { name: 'desert-road.jpg', w: 1400, h: 1050, sky: ['#6fa9d6', '#cfe3ee', '#f3d9a8'], sea: '#b9824d' },
    { name: 'studio-portrait.jpg', w: 1200, h: 1500, sky: ['#cbb8a8', '#e6d8c9', '#f4eadf'], sea: '#5d4639' },
  ];
  const files = [];
  for (const s of specs) {
    const b64 = await page.evaluate(async (s) => {
      const c = document.createElement('canvas'); c.width = s.w; c.height = s.h;
      const g = c.getContext('2d');
      const sky = g.createLinearGradient(0, 0, 0, s.h * 0.66);
      s.sky.forEach((col, i) => sky.addColorStop(i / (s.sky.length - 1), col));
      g.fillStyle = sky; g.fillRect(0, 0, s.w, s.h);
      const sun = g.createRadialGradient(s.w * 0.68, s.h * 0.52, 4, s.w * 0.68, s.h * 0.52, s.h * 0.22);
      sun.addColorStop(0, 'rgba(255,244,214,1)'); sun.addColorStop(1, 'rgba(255,244,214,0)');
      g.fillStyle = sun; g.fillRect(0, 0, s.w, s.h);
      g.fillStyle = s.sea; g.beginPath(); g.moveTo(0, s.h * 0.66);
      for (let x = 0; x <= s.w; x += 40) g.lineTo(x, s.h * (0.64 + 0.03 * Math.sin(x / 140)));
      g.lineTo(s.w, s.h); g.lineTo(0, s.h); g.fill();
      g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.moveTo(0, s.h); g.lineTo(s.w * 0.3, s.h * 0.72); g.lineTo(s.w * 0.55, s.h); g.fill();
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = ''; for (const x of buf) bin += String.fromCharCode(x);
      return btoa(bin);
    }, s);
    files.push({ name: s.name, mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') });
  }
  return files;
}

const browser = await chromium.launch();
for (const w of [390, 1440]) {
  const phone = w < 600;
  const ctx = await browser.newContext({
    viewport: { width: w, height: phone ? 844 : 900 }, deviceScaleFactor: 2,
    isMobile: phone, hasTouch: phone, reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const shot = async (name, full = false) => {
    await page.waitForTimeout(350);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (overflow > 0) console.warn(`! ${name}@${w}: horizontal overflow ${overflow}px`);
    await page.screenshot({ path: `${out}/${name}-${w}.png`, fullPage: full });
    console.log(`✓ ${name}-${w}`);
  };
  const ready = () => page.evaluate(() => document.fonts.ready);

  await page.goto(`${base}/styleguide.html`, { waitUntil: 'load' }); await ready();
  await shot('styleguide', true);

  await page.goto(`${base}/`, { waitUntil: 'load' }); await ready();
  await shot('1-albums-empty');
  await page.click('#btnNewAlbum');
  await page.waitForSelector('#viewAlbum:not(.hidden)');
  await shot('2-album-empty');
  await page.setInputFiles('#fileInput', await samplePhotos(page));
  await page.waitForSelector('.photo-card');
  await page.waitForTimeout(800);
  await shot('3-album-photos', true);
  await page.click('#btnSelect'); await page.click('.photo-card >> nth=0'); await page.click('.photo-card >> nth=2');
  await shot('4-select-mode');
  await page.click('#btnSelDone');
  await page.click('.photo-card >> nth=0');
  await page.waitForSelector('#viewEditor:not(.hidden)'); await page.waitForTimeout(700);
  await shot('5-editor-adjust');
  await page.evaluate(() => { const i = document.querySelector('#panelAdjust input'); i.value = 40; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await shot('6-editor-slider-changed');
  await page.click('#tabFilters'); await shot('7-editor-filters');
  await page.click('#tabCrop'); await page.waitForTimeout(500); await shot('8-editor-crop');
  await page.click('#tabText'); await shot('9-editor-text');
  await page.click('#tabAdjust');
  await page.click('#btnDone'); await page.waitForSelector('#viewAlbum:not(.hidden)');
  await page.click('#btnDownloadAlbum'); await shot('10-export-menu');
  if (errors.length) console.warn(`! console errors @${w}:`, [...new Set(errors)]);
  await ctx.close();
}
await browser.close();
