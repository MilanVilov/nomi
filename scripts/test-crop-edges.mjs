// E2E for the crop edge handles (mouse + touch) and screenshots.
// Usage: node scripts/test-crop-edges.mjs [baseUrl]   (dev server must be running, default :8811)
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://localhost:8811';
const out = path.join(root, 'docs/design');
mkdirSync(out, { recursive: true });
const req = createRequire(import.meta.url);
let chromium;
for (const dir of [process.env.NOMI_PLAYWRIGHT, path.join(root, 'node_modules'), path.join(root, '../redsgn/node_modules')].filter(Boolean)) {
  try { ({ chromium } = req(req.resolve('playwright', { paths: [dir] }))); break; } catch {}
}
if (!chromium) { console.error('Playwright not found'); process.exit(1); }

let fails = 0;
const ok = (c, n, extra = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + extra}`); if (!c) fails++; };
const near = (a, b, t = 0.6) => Math.abs(a - b) <= t;

async function photo(page) {
  const b64 = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 1600; c.height = 1067;
    const g = c.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, 700);
    sky.addColorStop(0, '#2b2d6e'); sky.addColorStop(0.5, '#d9604a'); sky.addColorStop(1, '#f6b45a');
    g.fillStyle = sky; g.fillRect(0, 0, 1600, 1067);
    g.fillStyle = '#1d3b52'; g.fillRect(0, 700, 1600, 367);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (const x of buf) s += String.fromCharCode(x);
    return btoa(s);
  });
  return { name: 'edges.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') };
}

// Box rect in px relative to #cropLayer, as fractions of the layer.
const frac = (page) => page.evaluate(() => {
  const l = document.getElementById('cropLayer').getBoundingClientRect();
  const b = document.getElementById('cropBox').getBoundingClientRect();
  return { x: (b.left - l.left) / l.width, y: (b.top - l.top) / l.height, w: b.width / l.width, h: b.height / l.height, l: l.toJSON(), b: b.toJSON() };
});
const same = (a, b, keys) => keys.every((k) => Math.abs(a[k] - b[k]) < 0.002);

async function openCrop(page) {
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.click('#btnNewAlbum');
  await page.waitForSelector('#viewAlbum:not(.hidden)');
  await page.setInputFiles('#fileInput', [await photo(page)]);
  await page.waitForSelector('.photo-card');
  await page.waitForTimeout(600);
  await page.click('.photo-card >> nth=0');
  await page.waitForSelector('#viewEditor:not(.hidden)');
  await page.waitForTimeout(600);
  await page.click('#tabCrop');
  await page.waitForTimeout(600);
}

// Pointer drag (mouse or touch) from the centre of handle `sel` by (dx,dy) px.
async function drag(page, touch, sel, dx, dy) {
  const hb = await page.evaluate((s) => document.querySelector(s).getBoundingClientRect().toJSON(), sel);
  const x = hb.x + hb.width / 2, y = hb.y + hb.height / 2;
  if (!touch) {
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 }); await page.mouse.move(x + dx, y + dy, { steps: 4 });
    await page.mouse.up();
  } else {
    const cdp = await page.context().newCDPSession(page);
    const tp = (type, px, py) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: px, y: py }] });
    await tp('touchStart', x, y);
    for (let i = 1; i <= 8; i++) await tp('touchMove', x + (dx * i) / 8, y + (dy * i) / 8);
    await tp('touchEnd');
    await cdp.detach();
  }
  await page.waitForTimeout(150);
}

async function suite(page, touch, tag) {
  await openCrop(page);
  const f0 = await frac(page);
  ok(near(f0.w, 1, 0.01) && near(f0.h, 1, 0.01), `${tag}: starts as the full image`);
  // Hit areas
  const hits = await page.evaluate(() => ['t', 'r', 'b', 'l'].map((e) => {
    const r = document.querySelector('#cropBox .h.' + e).getBoundingClientRect();
    return [e, Math.round(r.width), Math.round(r.height), getComputedStyle(document.querySelector('#cropBox .h.' + e)).cursor, getComputedStyle(document.querySelector('#cropBox .h.' + e)).touchAction];
  }));
  for (const [e, w, h, cur, ta] of hits) {
    const thick = e === 't' || e === 'b' ? h : w, len = e === 't' || e === 'b' ? w : h;
    ok(thick >= 44 && len > 100 && ta === 'none' && cur === (e === 't' || e === 'b' ? 'ns-resize' : 'ew-resize'), `${tag}: edge ${e} hit area`, JSON.stringify([w, h, cur, ta]));
  }
  // Free: each edge in turn, inward 80px; only its axis changes, toward the drag.
  const scale = { t: [0, 80], b: [0, -80], l: [80, 0], r: [-80, 0] };
  for (const e of ['t', 'b', 'l', 'r']) {
    await page.click('#aspectRow .chip >> nth=0');
    await page.click('#tabAdjust'); await page.click('#tabCrop'); await page.waitForTimeout(300);
    const before = await frac(page);
    const [dx, dy] = scale[e];
    await drag(page, touch, `#cropBox .h.${e}`, dx, dy);
    const after = await frac(page);
    const horiz = e === 't' || e === 'b';
    const otherSame = horiz ? same(before, after, ['x', 'w']) : same(before, after, ['y', 'h']);
    const grew = horiz ? after.h < before.h - 0.01 : after.w < before.w - 0.01;
    const px = (horiz ? before.h - after.h : before.w - after.w) * (horiz ? before.l.height : before.l.width);
    ok(otherSame && grew && Math.abs(px - 80) < 6, `${tag}: free ${e} edge shrinks only its axis by ~80px`, JSON.stringify({ before, after, px }));
    // reset via full-image: drag back out
    await drag(page, touch, `#cropBox .h.${e}`, -dx, -dy);
    const back = await frac(page);
    ok(same(back, before, ['x', 'y', 'w', 'h']), `${tag}: free ${e} edge drags back to full`, JSON.stringify({ back }));
  }
  // Body still moves: shrink first, then drag the body.
  await drag(page, touch, '#cropBox .h.r', -300, 0);
  const m0 = await frac(page);
  const bx = m0.b.x + m0.b.width / 2, by = m0.b.y + m0.b.height / 2;
  if (!touch) { await page.mouse.move(bx, by); await page.mouse.down(); await page.mouse.move(bx + 60, by, { steps: 5 }); await page.mouse.up(); }
  else {
    const cdp = await page.context().newCDPSession(page);
    const tp = (t, x, y) => cdp.send('Input.dispatchTouchEvent', { type: t, touchPoints: t === 'touchEnd' ? [] : [{ x, y }] });
    await tp('touchStart', bx, by); for (let i = 1; i <= 6; i++) await tp('touchMove', bx + 10 * i, by); await tp('touchEnd'); await cdp.detach();
  }
  await page.waitForTimeout(150);
  const m1 = await frac(page);
  ok(m1.x > m0.x + 0.02 && same(m0, m1, ['w', 'h']), `${tag}: dragging the body still moves the box`, JSON.stringify({ m0, m1 }));
  // Locked square: drag right edge in, ratio stays square in pixels, centre stays.
  await page.click('#aspectRow .chip:has-text("Square")');
  await page.waitForTimeout(300);
  const s0 = await frac(page);
  await drag(page, touch, '#cropBox .h.t', 0, 40);
  const s1 = await frac(page);
  const sq = (s) => near(s.b.width, s.b.height, 1.5);
  ok(sq(s0) && sq(s1) && s1.b.height < s0.b.height - 20, `${tag}: Square lock keeps 1:1 while dragging top edge`, JSON.stringify({ s0: [s0.b.width, s0.b.height], s1: [s1.b.width, s1.b.height] }));
  ok(near(s1.x + s1.w / 2, s0.x + s0.w / 2, 0.003) && near(s1.y + s1.h, s0.y + s0.h, 0.003), `${tag}: Square lock: opposite side fixed, centred on the other axis`);
  await drag(page, touch, '#cropBox .h.r', 500, 0);
  const s2 = await frac(page);
  ok(sq(s2) && s2.x >= -0.002 && s2.x + s2.w <= 1.002 && s2.y >= -0.002 && s2.y + s2.h <= 1.002, `${tag}: Square lock clamps inside the image`, JSON.stringify(s2));
}

const browser = await chromium.launch();
for (const [w, h, touch] of [[1440, 900, false], [390, 844, true]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: touch, hasTouch: touch, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await suite(page, touch, touch ? 'touch390' : 'mouse1440');
  // Screenshot: free crop, inset a bit so the edge bars are visible
  await page.click('#aspectRow .chip >> nth=0');
  await page.click('#tabAdjust'); await page.click('#tabCrop'); await page.waitForTimeout(300);
  await drag(page, touch, '#cropBox .h.t', 0, 50); await drag(page, touch, '#cropBox .h.l', 40, 0);
  await drag(page, touch, '#cropBox .h.b', 0, -30); await drag(page, touch, '#cropBox .h.r', -40, 0);
  await page.mouse.move(2, 2);
  await page.screenshot({ path: `${out}/crop-edges-${w}.png` });
  ok(!errors.length, `${w}: no page errors`, errors.join('; '));
  await ctx.close();
}
await browser.close();
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
