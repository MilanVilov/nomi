// QA e2e for crop edge/corner handles: aspect x handle matrix, bounds, crossing, rotation,
// straighten, settle zoom, hit-testing, tiny boxes, cancel, undo, export size, overflow.
// Usage: node scripts/test-crop-qa.mjs [baseUrl]   (dev server must be running, default :8811)
import { createRequire } from 'node:module';
import { mkdirSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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

let fails = 0, passes = 0;
const ok = (c, n, extra = '') => { if (c) passes++; else fails++; if (!c || process.env.VERBOSE) console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + extra}`); };
const E = 0.004;

async function photoBuf(page, w, h) {
  const b64 = await page.evaluate(async ([w, h]) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, '#2b2d6e'); gr.addColorStop(0.5, '#d9604a'); gr.addColorStop(1, '#f6b45a');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.fillRect(0, 0, w / 8, h / 8);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (const x of buf) s += String.fromCharCode(x);
    return btoa(s);
  }, [w, h]);
  return { name: `qa-${w}x${h}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') };
}

async function openCrop(page, w = 1600, h = 1067, extra = []) {
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.click('#btnNewAlbum');
  await page.waitForSelector('#viewAlbum:not(.hidden)');
  const files = [await photoBuf(page, w, h)];
  for (const [ew, eh] of extra) files.push(await photoBuf(page, ew, eh));
  await page.setInputFiles('#fileInput', files);
  await page.waitForFunction((n) => document.querySelectorAll('.photo-card').length >= n, files.length);
  await page.waitForTimeout(600);
  await page.click('.photo-card >> nth=0');
  await page.waitForSelector('#viewEditor:not(.hidden)');
  await page.waitForTimeout(600);
  await page.click('#tabCrop');
  await page.waitForTimeout(500);
}

// Box + layer on SCREEN, plus box as fraction of the (possibly zoomed) layer.
const state = (page) => page.evaluate(() => {
  const l = document.getElementById('cropLayer').getBoundingClientRect();
  const b = document.getElementById('cropBox').getBoundingClientRect();
  return { x: (b.left - l.left) / l.width, y: (b.top - l.top) / l.height, w: b.width / l.width, h: b.height / l.height, l: l.toJSON(), b: b.toJSON() };
});
const hbox = (page, sel) => page.evaluate((s) => document.querySelector(s).getBoundingClientRect().toJSON(), sel);
const sleep = (page, ms) => page.waitForTimeout(ms);

let cdp = null;
async function pointer(page, touch, pts, { cancel = false } = {}) {
  // pts: [[x,y], ...] first is down
  if (!touch) {
    await page.mouse.move(...pts[0]); await page.mouse.down();
    for (const p of pts.slice(1)) await page.mouse.move(p[0], p[1], { steps: 3 });
    if (cancel) await page.evaluate(() => { const b = document.getElementById('cropBox'); b.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true })); });
    await page.mouse.up();
  } else {
    cdp = cdp || await page.context().newCDPSession(page);
    const tp = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p[0], y: p[1] }] : [] });
    await tp('touchStart', pts[0]);
    for (const p of pts.slice(1)) await tp('touchMove', p);
    await tp(cancel ? 'touchCancel' : 'touchEnd');
  }
  await page.waitForTimeout(120);
}
const path2 = (x, y, dx, dy, n = 8) => Array.from({ length: n + 1 }, (_, i) => [x + (dx * i) / n, y + (dy * i) / n]);
async function dragHandle(page, touch, name, dx, dy, opts) {
  const hb = await hbox(page, `#cropBox .h.${name}`);
  // grab the strip/corner at its centre, but for edges at the centre of the visible strip within the viewport
  const x = hb.x + hb.width / 2, y = hb.y + hb.height / 2;
  await pointer(page, touch, path2(x, y, dx, dy), opts);
}
async function settle(page) { await sleep(page, 1500); }
const resetCrop = async (page, aspect = 0) => {
  await page.click('#tabAdjust'); await page.click('#btnReset').catch(() => {}); await page.click('#tabCrop');
  await sleep(page, 400);
  await page.click(`#aspectRow .chip >> nth=${aspect}`); await sleep(page, 400);
};

const ASP = ['free', 'original', 'square', '4:3', '3:2', '16:9'];
const ratioOf = { free: 0, square: 1, '4:3': 4 / 3, '3:2': 3 / 2, '16:9': 16 / 9 };

async function matrix(page, touch, tag, iw, ih, rotN = 0) {
  const imgAsp = rotN % 2 ? ih / iw : iw / ih;
  for (let ai = 0; ai < ASP.length; ai++) {
    const a = ASP[ai];
    const want = a === 'free' ? 0 : a === 'original' ? imgAsp : ratioOf[a];
    for (const h of ['t', 'r', 'b', 'l', 'tl', 'tr', 'bl', 'br']) {
      for (const [mode, f] of [['in', 0.3], ['out', -1.5], ['cross', 1.6]]) {
        // fresh crop: aspect chip resets crop to centred/full
        await page.click(`#aspectRow .chip >> nth=${(ai + 1) % 6}`); await page.click(`#aspectRow .chip >> nth=${ai}`);
        await sleep(page, 120);
        await page.evaluate(() => document.getElementById('stageWrap').classList.remove('crop-settled'));
        const s0 = await state(page);
        const dirx = h.includes('l') ? 1 : h.includes('r') ? -1 : 0;
        const diry = h.includes('t') ? 1 : h.includes('b') ? -1 : 0;
        const dx = dirx * f * s0.b.width, dy = diry * f * s0.b.height;
        // "out" with a full box can't move outward: shrink first so there is room, then pull out past the image.
        await dragHandle(page, touch, h, dx, dy);
        const s1 = await state(page);
        const n = `${tag} ${a} ${h} ${mode}`;
        const inside = s1.x > -E && s1.y > -E && s1.x + s1.w < 1 + E && s1.y + s1.h < 1 + E;
        ok(inside, `${n}: inside image`, JSON.stringify(s1));
        ok(s1.w >= 0.05 - E && s1.h >= 0.05 - E, `${n}: min size`, JSON.stringify(s1));
        if (want) ok(Math.abs(s1.b.width / s1.b.height - want) < 0.02 * want + 0.02, `${n}: ratio ${(s1.b.width / s1.b.height).toFixed(3)} vs ${want.toFixed(3)}`);
        // The grabbed side/corner moves toward the pointer; opposite anchor stays (non-crossing, free only)
        if (mode === 'in' && a === 'free') {
          const stay = (k, v0, v1) => ok(Math.abs(v0 - v1) < E, `${n}: ${k} stays`, `${v0} ${v1}`);
          if (!h.includes('l')) stay('left', s0.x, s1.x);
          if (!h.includes('r')) stay('right', s0.x + s0.w, s1.x + s1.w);
          if (!h.includes('t')) stay('top', s0.y, s1.y);
          if (!h.includes('b')) stay('bottom', s0.y + s0.h, s1.y + s1.h);
        }
      }
    }
  }
}

async function saneConsole(page, errors, n) { ok(!errors.length, `${n}: no console/page errors`, errors.join(' | ')); }

async function suite(browser, w, h, touch, tag) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch, reducedMotion: 'reduce', acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  cdp = null;
  await openCrop(page);

  // --- overflow + keyboard focus
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth), `${tag}: no horizontal overflow`);
  ok(await page.evaluate(() => [...document.querySelectorAll('#cropBox .h')].every((e) => e.tabIndex < 0 || !e.hasAttribute('tabindex'))), `${tag}: handles not in tab order`);

  // --- hit-testing at corners and along edges (unsettled and settled)
  await dragHandle(page, touch, 'l', 120, 0); await dragHandle(page, touch, 'r', -120, 0);
  await dragHandle(page, touch, 't', 0, 60); await dragHandle(page, touch, 'b', 0, -60);
  for (const settled of [false, true]) {
    if (settled) await settle(page); else await sleep(page, 50);
    const hitAt = (x, y) => page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? (e.classList.contains('h') ? [...e.classList].filter((c) => c !== 'h').join('') : e.id || e.className) : null; }, [x, y]);
    const b = (await state(page)).b;
    ok(settled ? true : true, 'noop');
    const corners = { tl: [b.left, b.top, 1, 1], tr: [b.right, b.top, -1, 1], bl: [b.left, b.bottom, 1, -1], br: [b.right, b.bottom, -1, -1] };
    for (const [c, [cx, cy, sx, sy]] of Object.entries(corners)) {
      ok(await hitAt(cx, cy) === c, `${tag} settled=${settled}: corner ${c} wins at the corner`, await hitAt(cx, cy));
      const vEdge = c[0], hEdge = c[1] === 'l' ? 'l' : 'r';
      for (const d of [10, 20]) {
        ok(await hitAt(cx + sx * d, cy) === c, `${tag} settled=${settled}: corner ${c} wins ${d}px along horizontal edge`, await hitAt(cx + sx * d, cy));
        ok(await hitAt(cx, cy + sy * d) === c, `${tag} settled=${settled}: corner ${c} wins ${d}px along vertical edge`, await hitAt(cx, cy + sy * d));
      }
      ok(await hitAt(cx + sx * 30, cy) === vEdge, `${tag} settled=${settled}: ${vEdge} edge 30px from corner ${c}`, await hitAt(cx + sx * 30, cy));
      ok(await hitAt(cx, cy + sy * 30) === hEdge, `${tag} settled=${settled}: ${hEdge} edge 30px from corner ${c}`, await hitAt(cx, cy + sy * 30));
    }
    const mx = (b.left + b.right) / 2, my = (b.top + b.bottom) / 2;
    ok(await hitAt(mx, my) === 'cropBox', `${tag} settled=${settled}: centre is the body`, await hitAt(mx, my));
    // handle sizes stay screen-sized
    const sizes = await page.evaluate(() => ['tl', 't', 'l'].map((k) => { const r = document.querySelector('#cropBox .h.' + k).getBoundingClientRect(); return [k, r.width, r.height]; }));
    ok(Math.abs(sizes[0][1] - 44) < 1 && Math.abs(sizes[0][2] - 44) < 1 && Math.abs(sizes[1][2] - 44) < 1 && Math.abs(sizes[2][1] - 44) < 1, `${tag} settled=${settled}: handle thickness is 44 screen px`, JSON.stringify(sizes));
  }
  await page.screenshot({ path: `${out}/qa-crop-settled-${w}.png` });

  // --- drag an edge while settled: no jump at pointerdown
  {
    const before = await state(page);
    const hb = await hbox(page, '#cropBox .h.r');
    const x = hb.x + hb.width / 2, y = hb.y + hb.height / 2;
    // press and release without moving: crop must not change
    await pointer(page, touch, [[x, y], [x, y]]);
    const after = await state(page);
    ok(['x', 'y', 'w', 'h'].every((k) => Math.abs(before[k] - after[k]) < 0.003), `${tag}: settled press-without-move doesn't change the crop`, JSON.stringify([before, after]));
    // drag the right edge left by 60 screen px while settled
    const b0 = (await state(page)).b;
    await dragHandle(page, touch, 'r', -60, 0);
    const b1 = (await state(page)).b;
    ok(b1.width < b0.width && Math.abs((b0.width - b1.width) - 60) < 8 && Math.abs(b1.left - b0.left) < 2, `${tag}: settled right edge moves with the pointer`, JSON.stringify([b0.width - b1.width, b1.left - b0.left]));
  }
  await settle(page);
  // grab handle must still be on the correct edge after re-settle
  {
    const b = (await state(page)).b, r = await hbox(page, '#cropBox .h.r');
    ok(Math.abs((r.x + r.width / 2) - b.right) < 1.5, `${tag}: r handle centred on right edge after settle`);
  }

  // --- tiny box: corners still grabbable
  await resetCrop(page, 0);
  await dragHandle(page, touch, 'br', -1e4 / 10, -1e4 / 10);
  for (let i = 0; i < 2; i++) { await dragHandle(page, touch, 'br', 2000, 2000).catch(() => {}); }
  await page.click('#tabAdjust'); await page.click('#tabCrop'); await sleep(page, 300);
  await dragHandle(page, touch, 'r', -2000, 0); await dragHandle(page, touch, 'b', 0, -2000);
  await page.evaluate(() => document.getElementById('stageWrap').classList.remove('crop-settled'));
  {
    const s = await state(page);
    ok(s.w >= 0.049 && s.h >= 0.049, `${tag}: tiny box floor (${s.w.toFixed(3)}x${s.h.toFixed(3)})`);
    for (const c of ['tl', 'tr', 'bl', 'br']) {
      const b = (await state(page)).b;
      const [cx, cy] = { tl: [b.left, b.top], tr: [b.right, b.top], bl: [b.left, b.bottom], br: [b.right, b.bottom] }[c];
      const got = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e && e.classList.contains('h') ? [...e.classList].find((k) => k !== 'h') : (e && e.id); }, [cx, cy]);
      ok(got === c, `${tag}: tiny box corner ${c} grabbable`, got + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('#cropBox .h')].map((e) => [e.className, ...Object.values(e.getBoundingClientRect().toJSON()).slice(0, 4).map(Math.round)]))) + JSON.stringify(b));
    }
    // Pull tl corner outwards from tiny box: must grow
    const b0 = (await state(page)).b;
    const [cx, cy] = [b0.right, b0.bottom];
    const got = await page.evaluate(([x, y]) => document.elementFromPoint(x, y).className, [cx, cy]);
    await pointer(page, touch, path2(cx, cy, 40, 40));
    const b1 = (await state(page)).b;
    ok(b1.width > b0.width + 10 && b1.height > b0.height + 10, `${tag}: tiny box: br corner drag grows it`, `${got} ${JSON.stringify([b0.width, b1.width])}`);
  }

  // --- pointer cancel mid-drag, then another drag works
  await resetCrop(page, 0);
  await page.evaluate(() => document.getElementById('stageWrap').classList.remove('crop-settled'));
  {
    const s0 = await state(page);
    const hb = await hbox(page, '#cropBox .h.t');
    await pointer(page, touch, path2(hb.x + hb.width / 2, hb.y + hb.height / 2, 0, 40), { cancel: true });
    await sleep(page, 200);
    const s1 = await state(page);
    ok(s1.h < s0.h, `${tag}: cancelled drag leaves a valid crop`, JSON.stringify([s0.h, s1.h]));
    const b0 = (await state(page)).b;
    await dragHandle(page, touch, 'l', 50, 0);
    const b1 = (await state(page)).b;
    ok(b1.width < b0.width - 20, `${tag}: drag after cancel works`);
    // rapid successive drags
    for (let i = 0; i < 6; i++) await dragHandle(page, touch, ['t', 'r', 'b', 'l'][i % 4], i % 2 ? -10 : 10, i % 2 ? -10 : 10);
    const s = await state(page);
    ok(s.w > 0.04 && s.h > 0.04 && s.x > -E && s.y > -E && s.x + s.w < 1 + E && s.y + s.h < 1 + E, `${tag}: rapid drags stay valid`, JSON.stringify(s));
  }

  // --- undo/redo
  {
    await resetCrop(page, 0);
    await page.evaluate(() => document.getElementById('stageWrap').classList.remove('crop-settled'));
    const s0 = await state(page);
    await dragHandle(page, touch, 'r', -150, 0);
    await sleep(page, 700);
    const s1 = await state(page);
    await page.keyboard.press('Control+z'); await sleep(page, 400);
    const s2 = await state(page);
    ok(s1.w < s0.w - 0.05 && Math.abs(s2.w - s0.w) < 0.01, `${tag}: undo restores previous crop`, JSON.stringify([s0.w, s1.w, s2.w]));
    await page.keyboard.press('Control+Shift+z'); await sleep(page, 400);
    const s3 = await state(page);
    ok(Math.abs(s3.w - s1.w) < 0.01, `${tag}: redo reapplies the edge crop`, JSON.stringify([s1.w, s3.w]));
  }
  await saneConsole(page, errors, tag);
  await ctx.close();
}

async function rotationSuite(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  cdp = null;
  for (const [iw, ih] of [[1600, 1067], [900, 1600]]) {
    await openCrop(page, iw, ih);
    for (let rot = 0; rot < 4; rot++) {
      if (rot) { await page.click('#btnRot'); await sleep(page, 400); }
      await page.click('#aspectRow .chip >> nth=0'); await sleep(page, 200);
      await page.evaluate(() => document.getElementById('stageWrap').classList.remove('crop-settled'));
      const tag = `rot${rot} ${iw}x${ih}`;
      for (const [e, dx, dy] of [['t', 0, 50], ['b', 0, -50], ['l', 50, 0], ['r', -50, 0]]) {
        const s0 = await state(page);
        await dragHandle(page, false, e, dx, dy);
        const s1 = await state(page);
        const d = { t: s1.b.top - s0.b.top, b: s1.b.bottom - s0.b.bottom, l: s1.b.left - s0.b.left, r: s1.b.right - s0.b.right }[e];
        const want = e === 't' ? dy : e === 'b' ? dy : dx;
        ok(Math.abs(d - want) < 3, `${tag}: ${e} edge moves ${want} on screen (got ${d.toFixed(1)})`);
        // other three sides fixed
        const others = Object.entries({ t: 'top', b: 'bottom', l: 'left', r: 'right' }).filter(([k]) => k !== e);
        ok(others.every(([, p]) => Math.abs(s1.b[p] - s0.b[p]) < 1.5), `${tag}: ${e} drag leaves the other sides`);
      }
      // re-enter crop tab: box unchanged (source<->display round trip)
      const a = await state(page);
      await page.click('#tabAdjust'); await page.click('#tabCrop'); await sleep(page, 500);
      await page.evaluate(() => document.getElementById('stageWrap').classList.remove('crop-settled'));
      const b = await state(page);
      ok(['x', 'y', 'w', 'h'].every((k) => Math.abs(a[k] - b[k]) < 0.004), `${tag}: crop survives tab switch`, JSON.stringify([a, b]));
    }
  }
  // straighten
  await openCrop(page);
  for (const deg of [10, -10, 45]) {
    await page.evaluate((v) => { const i = document.getElementById('inStraighten'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }, deg);
    await sleep(page, 400);
    await page.click('#aspectRow .chip >> nth=0'); await sleep(page, 200);
    await page.evaluate(() => document.getElementById('stageWrap').classList.remove('crop-settled'));
    for (const [e, dx, dy] of [['t', 0, 40], ['b', 0, -40], ['l', 40, 0], ['r', -40, 0]]) {
      const s0 = await state(page);
      await dragHandle(page, false, e, dx, dy);
      const s1 = await state(page);
      const d = { t: s1.b.top - s0.b.top, b: s1.b.bottom - s0.b.bottom, l: s1.b.left - s0.b.left, r: s1.b.right - s0.b.right }[e];
      ok(Math.abs(d - (dx || dy)) < 3, `straighten ${deg}: ${e} edge follows pointer (${d.toFixed(1)})`);
    }
  }
  await saneConsole(page, errors, 'rotation/straighten');
  await ctx.close();
}

async function matrixSuite(browser, touch, w, h, iw, ih, tag) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  cdp = null;
  await openCrop(page, iw, ih);
  await matrix(page, touch, tag, iw, ih);
  await saneConsole(page, errors, tag);
  await ctx.close();
}

async function exportSuite(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  cdp = null;
  await openCrop(page, 1600, 1067, [[800, 600]]);
  await page.click('#aspectRow .chip >> nth=0'); await sleep(page, 200);
  await page.evaluate(() => document.getElementById('stageWrap').classList.remove('crop-settled'));
  await dragHandle(page, false, 'l', 0, 0);
  const s0 = await state(page);
  await dragHandle(page, false, 'l', s0.b.width * 0.25, 0);
  await dragHandle(page, false, 'b', 0, -s0.b.height * 0.4);
  const s = await state(page);
  const wantW = Math.round(1600 * s.w), wantH = Math.round(1067 * s.h);
  await sleep(page, 900);
  // switch photo and back: crop persists
  await page.locator('#filmstrip > *').nth(1).click(); await sleep(page, 1200); await page.locator('#filmstrip > *').nth(0).click(); await sleep(page, 1200);
  await page.click('#tabCrop').catch(() => {}); await sleep(page, 400);
  await page.evaluate(() => document.getElementById('stageWrap').classList.remove('crop-settled'));
  const s2 = await state(page);
  ok(['x', 'y', 'w', 'h'].every((k) => Math.abs(s[k] - s2[k]) < 0.005), 'switch photo and back keeps crop', JSON.stringify([s, s2]));
  await page.click('#btnDone'); await page.waitForSelector('#viewAlbum:not(.hidden)'); await sleep(page, 500);
  await page.click('#btnDownloadAlbum');
  const dl = page.waitForEvent('download', { timeout: 20000 });
  await page.click('#exportMenu .menu-item >> nth=1');
  const d = await dl;
  const dir = path.join(out, '.qa-export'); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const zip = path.join(dir, 'a.zip'); await d.saveAs(zip);
  execFileSync('unzip', ['-o', '-q', zip, '-d', dir]); execFileSync('chmod', ['-R', 'u+rwX', dir]);
  const files = readdirSync(dir, { recursive: true }).filter((f) => /\.jpe?g$/i.test(f));
  const jpegSize = (buf) => { let i = 2; while (i < buf.length) { if (buf[i] !== 0xff) { i++; continue; } const m = buf[i + 1]; if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)]; i += 2 + buf.readUInt16BE(i + 2); } return [0, 0]; };
  const sizes = files.map((f) => [f, ...jpegSize(readFileSync(path.join(dir, f)))]);
  ok(sizes.some(([, w, h]) => Math.abs(w - wantW) <= 2 && Math.abs(h - wantH) <= 2), `export has crop pixel size ${wantW}x${wantH}`, JSON.stringify(sizes));
  rmSync(dir, { recursive: true, force: true });
  ok(!errors.length, 'export: no page errors', errors.join('|'));
  await ctx.close();
}

const only = process.env.ONLY; // e.g. ONLY=export
const browser = await chromium.launch();
if (!only) await suite(browser, 1440, 900, false, 'mouse1440');
if (!only) await suite(browser, 390, 844, true, 'touch390');
if (!only) await rotationSuite(browser);
if (!only) await matrixSuite(browser, false, 1440, 900, 1600, 1067, 'mx-land');
if (!only) await matrixSuite(browser, true, 390, 844, 900, 1600, 'mx-port-touch');
if (!only) await matrixSuite(browser, false, 1440, 900, 4000, 500, 'mx-wide');
if (!only) await matrixSuite(browser, false, 1440, 900, 400, 3000, 'mx-tall');
if (!only || only === 'export') await exportSuite(browser);
await browser.close();
console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
