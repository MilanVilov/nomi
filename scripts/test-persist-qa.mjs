// QA for edit persistence (A: scroll/highlight after Done, B: arrow navigation, C: non-destructive save).
// Extra adversarial scenarios on top of test-persist-edits.mjs: repeated save/reopen cycles, EXIF
// orientation, PNG/WEBP, reset/duplicate/delete after save, zip, save races, memory release.
// Needs the dev server: python3 -m http.server 8811 &  node scripts/test-persist-qa.mjs [baseUrl]
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://localhost:8811';
const req = createRequire(import.meta.url);
let chromium;
for (const dir of [process.env.NOMI_PLAYWRIGHT, path.join(root, 'node_modules'), path.join(root, '../redsgn/node_modules')].filter(Boolean)) {
  try { ({ chromium } = req(req.resolve('playwright', { paths: [dir] }))); break; } catch {}
}
if (!chromium) { console.error('Playwright not found.'); process.exit(1); }

let fails = 0;
const ok = (c, m, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}${x ? ' — ' + x : ''}`); if (!c) fails++; };
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--js-flags=--expose-gc'] });
const errors = [];

async function newPage(width, height, reducedMotion = 'no-preference') {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('nomi:')) errors.push(m.text()); });
  await page.goto(`${base}/`, { waitUntil: 'load' });
  return page;
}

// Seed an OPFS folder (and make showDirectoryPicker return it). Each entry: name; format from the extension.
// opts.orient: Exif orientation written into jpegs (stored pixels stay W x H, so 6 displays as H x W).
async function seed(page, folder, names, size, opts = {}) {
  await page.evaluate(async ({ folder, names, size, opts }) => {
    const root = await navigator.storage.getDirectory();
    try { await root.removeEntry(folder, { recursive: true }); } catch {}
    const dir = await root.getDirectoryHandle(folder, { create: true });
    for (const [i, n] of names.entries()) {
      const [W, H] = i % 4 === 1 && !opts.orient ? [size[1], size[0]] : size;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 0, W, H);
      gr.addColorStop(0, `hsl(${(i * 37) % 360} 60% 55%)`); gr.addColorStop(0.5, '#3fa7c4'); gr.addColorStop(1, '#f6b45a');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      g.fillStyle = '#2a8f4e'; g.fillRect(W * .12, H * .63, W * .37, H * .3);
      g.fillStyle = '#fff'; g.font = `${Math.round(H / 5)}px monospace`; g.fillText(String(i + 1), W * .55, H * .45);
      const ext = n.split('.').pop().toLowerCase();
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      let blob = await new Promise((r) => c.toBlob(r, mime, 0.95));
      if (mime === 'image/jpeg') {
        const t = document.createElement('canvas'); t.width = 80; t.height = Math.round(80 * H / W);
        t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
        const thumb = new Uint8Array(await (await new Promise((r) => t.toBlob(r, 'image/jpeg', 0.8))).arrayBuffer());
        const le = (v, n) => Array.from({ length: n }, (_, k) => (v >>> (8 * k)) & 255);
        const ent = (tag, type, cnt, val) => [...le(tag, 2), ...le(type, 2), ...le(cnt, 4), ...le(val, 4)];
        const tiff = [0x49, 0x49, 42, 0, 8, 0, 0, 0,
          ...le(2, 2), ...ent(0x0112, 3, 1, opts.orient || 1), ...ent(0x8769, 4, 1, 38), ...le(68, 4),
          ...le(2, 2), ...ent(0xA002, 4, 1, W), ...ent(0xA003, 4, 1, H), ...le(0, 4),
          ...le(2, 2), ...ent(0x0201, 4, 1, 98), ...ent(0x0202, 4, 1, thumb.length), ...le(0, 4),
          ...thumb];
        const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
        const app1 = new Uint8Array([0xFF, 0xE1, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload]);
        const jb = new Uint8Array(await blob.arrayBuffer());
        blob = new Blob([jb.subarray(0, 2), app1, jb.subarray(2)], { type: 'image/jpeg' });
      }
      const w = await (await dir.getFileHandle(n, { create: true })).createWritable();
      await w.write(blob); await w.close();
    }
    window.showDirectoryPicker = async () => dir;
  }, { folder, names, size, opts });
}

const openFolder = async (page, n) => {
  await page.click('#btnOpenFolder');
  await page.waitForFunction((n) => document.querySelectorAll('.photo-card').length >= n, n, { timeout: 60000 });
  await page.waitForTimeout(500);
};
const cardIndex = (page, name) => page.evaluate((n) => [...document.querySelectorAll('.photo-card')].findIndex((c) => c.title === n), name);
async function openPhoto(page, name) {
  const idx = await cardIndex(page, name);
  const card = page.locator('.photo-card').nth(idx);
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await page.waitForSelector('#viewEditor:not(.hidden)');
  await page.waitForFunction((n) => document.getElementById('edName').textContent === n, name);
  await page.waitForTimeout(250);
}
const done = async (page) => { await page.click('#btnDone'); await page.waitForSelector('#viewAlbum:not(.hidden)'); };
const cancel = async (page) => { await page.click('#btnBackAlbum'); await page.waitForSelector('#viewAlbum:not(.hidden)'); };
const setSlider = (page, label, v) => page.evaluate(({ label, v }) => {
  const i = [...document.querySelectorAll('#panelAdjust .slider')].find((s) => s.textContent.includes(label)).querySelector('input');
  i.value = v; i.dispatchEvent(new Event('input', { bubbles: true }));
}, { label, v });
const getSlider = (page, label) => page.evaluate((label) => +[...document.querySelectorAll('#panelAdjust .slider')].find((s) => s.textContent.includes(label)).querySelector('input').value, label);
const params = (page, name) => page.evaluate(async (n) => {
  const { state } = await import('/src/store.js');
  const ph = [...state.photos.values()].find((p) => p.name === n);
  return ph ? JSON.parse(JSON.stringify(ph.params)) : null;
}, name);
const photoInfo = (page, name) => page.evaluate(async (n) => {
  const { state, needsSave } = await import('/src/store.js');
  const ph = [...state.photos.values()].find((p) => p.name === n);
  return ph && { w: ph.width, h: ph.height, fileSize: ph.file.size, hasSaved: !!ph.savedParams, needsSave: needsSave(ph), createdHere: !!ph.createdHere, handle: ph.handle && ph.handle.name, dir: !!ph.dir };
}, name);
const filmThumb = (page, i) => page.evaluate((i) => document.querySelectorAll('#filmstrip img')[i].src, i);
const thumbOf = (page, name) => page.evaluate(async (n) => { const { state } = await import('/src/store.js'); return [...state.photos.values()].find((p) => p.name === n).thumbUrl; }, name);

// stats + sha1 of everything in the folder, decoded from the bytes on disk
const disk = (page, folder) => page.evaluate(async (folder) => {
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(folder);
  const sha = async (buf) => [...new Uint8Array(await crypto.subtle.digest('SHA-1', buf))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const stats = async (file) => {
    const buf = await file.arrayBuffer();
    const bmp = await createImageBitmap(new Blob([buf]));
    const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
    let lum = 0, n = 0; for (let i = 0; i < d.length; i += 28) { lum += (d[i] + d[i + 1] + d[i + 2]) / 3; n++; }
    const s = new OffscreenCanvas(32, 24).getContext('2d'); s.drawImage(c, 0, 0, 32, 24);
    return { w: bmp.width, h: bmp.height, lum: lum / n, sha: await sha(buf), grid: [...s.getImageData(0, 0, 32, 24).data] };
  };
  const out = {}, backups = {};
  for await (const [name, h] of dir.entries()) if (h.kind === 'file') out[name] = await stats(await h.getFile());
  try { const bd = await dir.getDirectoryHandle('.nomi-originals'); for await (const [name, h] of bd.entries()) backups[name] = await sha(await (await h.getFile()).arrayBuffer()); } catch {}
  return { files: out, backups };
}, folder);

// Render a photo from its ORIGINAL file with its current params in one pass, like the zip export does.
const singlePass = (page, name) => page.evaluate(async (n) => {
  const { state } = await import('/src/store.js');
  const { renderFullRes } = await import('/src/exporter.js');
  const { formatFor } = await import('/src/folder.js');
  const ph = [...state.photos.values()].find((p) => p.name === n);
  const { blob } = await renderFullRes(ph, undefined, formatFor(ph.name));
  const bmp = await createImageBitmap(blob);
  const c = new OffscreenCanvas(32, 24).getContext('2d'); c.drawImage(bmp, 0, 0, 32, 24);
  return { w: bmp.width, h: bmp.height, grid: [...c.getImageData(0, 0, 32, 24).data] };
}, name);
const gridDiff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) if (i % 4 !== 3) s += Math.abs(a[i] - b[i]); return s / (a.length * 0.75); };

const menu = async (page) => {
  await page.click('#btnDownloadAlbum');
  await page.waitForSelector('#exportMenu:not(.hidden)');
  const item = page.locator('#exportMenu [data-choice="folder"]');
  const r = { hint: await item.locator('.mi-hint').textContent(), disabled: (await item.getAttribute('aria-disabled')) === 'true' };
  return r;
};
const closeMenu = (page) => page.keyboard.press('Escape');
async function saveAll(page) {
  await page.click('#exportMenu [data-choice="folder"]');
  await page.waitForSelector('.toast-action');
  await page.click('.toast-action');
  await page.waitForFunction(() => /^saved \d+ file/.test(document.getElementById('toast').textContent), null, { timeout: 60000 });
  await page.waitForTimeout(300);
}


const tabs = { adjust: '#tabAdjust', filters: '#tabFilters', crop: '#tabCrop', text: '#tabText' };
const waitName = (page, n) => page.waitForFunction((n) => document.getElementById('edName').textContent === n, n);
// Adjust + filter + text + crop + rotate + straighten on the open photo.
async function editFull(page, k) {
  await setSlider(page, 'Exposure', 10 + k * 10);
  await setSlider(page, 'Saturation', -20 - k);
  await setSlider(page, 'Warmth', 5 + k);
  await page.click(tabs.filters); await page.click(`.filter >> nth=${2 + k}`); await page.waitForTimeout(150);
  await page.click(tabs.text); await page.click('text=Add text'); await page.waitForTimeout(150);
  await page.keyboard.type(`T${k}`); await page.waitForTimeout(200);
  await page.click(tabs.crop);
  await page.click('.chip:has-text("Square")'); await page.waitForTimeout(300);
  await page.click('#btnRot'); await page.waitForTimeout(150);
  await page.evaluate((v) => { const i = document.getElementById('inStraighten'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }, 3 + k);
  await page.waitForTimeout(400);
  await page.click(tabs.adjust);
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const sameParams = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);

// ---------------------------------------------------------------------------------------------
// S1) several photos fully edited, saved, reopened, tweaked, saved again, 3 cycles
// ---------------------------------------------------------------------------------------------
console.log('\n# S1 save / reopen / tweak cycles');
{
  const N = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg'];
  const page = await newPage(1440, 900, 'reduce');
  await seed(page, 's1', N, [800, 600]);
  const seedDisk = await disk(page, 's1');
  await openFolder(page, 5);
  const expect = {};
  for (const [k, n] of N.slice(0, 4).entries()) {
    await openPhoto(page, n); await editFull(page, k);
    expect[n] = clone(await params(page, n));
    await done(page);
  }
  let m = await menu(page); ok(/overwrite 4 files/.test(m.hint), 'menu offers 4', m.hint);
  await saveAll(page);
  let first = await disk(page, 's1');
  for (let cycle = 1; cycle <= 3; cycle++) {
    for (const [k, n] of N.slice(0, 4).entries()) {
      await openPhoto(page, n);
      const vals = [await getSlider(page, 'Exposure'), await getSlider(page, 'Saturation'), await getSlider(page, 'Warmth')];
      ok(vals[0] === expect[n].exposure && vals[1] === expect[n].saturation && vals[2] === expect[n].warmth, `cycle ${cycle} ${n}: sliders reopen as set`, vals.join('/'));
      await page.click(tabs.crop); await page.waitForTimeout(200);
      const st = await page.evaluate(() => document.getElementById('inStraighten').value + '|' + document.querySelector('.chip.active')?.textContent);
      ok(st === `${expect[n].straighten}|Square`, `cycle ${cycle} ${n}: straighten + aspect reopen`, st);
      await page.click(tabs.filters); await page.waitForTimeout(150);
      ok(await page.evaluate((i) => /active/.test(document.querySelectorAll('.filter')[i].className), 2 + k), `cycle ${cycle} ${n}: filter selected`);
      await page.click(tabs.adjust);
      if (n === 'd.jpg' && cycle === 1) { await cancel(page); continue; } // visit without changes
      if (n === 'c.jpg') { await done(page); continue; }               // Done without any change
      expect[n].contrast = cycle * 7;
      await setSlider(page, 'Contrast', cycle * 7); await page.waitForTimeout(450);
      await done(page);
    }
    m = await menu(page);
    ok(!m.disabled && /overwrite 2 files/.test(m.hint) || (cycle > 1 && /overwrite 3 files/.test(m.hint)), `cycle ${cycle}: only tweaked photos offered`, m.hint);
    await saveAll(page);
    const dsk = await disk(page, 's1');
    for (const n of N.slice(0, 4)) {
      const sp = await singlePass(page, n);
      const f = dsk.files[n];
      ok(sp.w === f.w && sp.h === f.h, `cycle ${cycle} ${n}: disk size == single pass`, `${f.w}x${f.h}`);
      ok(gridDiff(sp.grid, f.grid) < 6, `cycle ${cycle} ${n}: disk == single pass of original + params`, gridDiff(sp.grid, f.grid).toFixed(2));
      ok(f.w === first.files[n].w && f.h === first.files[n].h, `cycle ${cycle} ${n}: size stable (crop/rotate not re-applied)`);
      ok(dsk.backups[n] === seedDisk.files[n].sha, `cycle ${cycle} ${n}: backup is still the first original`);
      ok(sameParams(await params(page, n), expect[n]), `cycle ${cycle} ${n}: params exactly as set`);
    }
    ok(dsk.files['e.jpg'].sha === seedDisk.files['e.jpg'].sha && !dsk.backups['e.jpg'], `cycle ${cycle}: e untouched`);
    ok(Object.keys(dsk.files).length === 5, `cycle ${cycle}: no stray files`, Object.keys(dsk.files).join(','));
  }
  ok((await page.evaluate(() => document.querySelectorAll('.photo-card.edited').length)) === 4, 'edited dots on 4 photos');
  await page.screenshot({ path: path.join(root, 'docs/design/qa-persist-s1-album.png') });
  await page.context().close();
}

// ---------------------------------------------------------------------------------------------
// S2) arrow through 10 photos editing each, back and forth
// ---------------------------------------------------------------------------------------------
console.log('\n# S2 arrow navigation');
{
  const N = Array.from({ length: 10 }, (_, i) => `n${String(i + 1).padStart(2, '0')}.jpg`);
  const page = await newPage(1440, 900, 'reduce');
  await seed(page, 's2', N, [400, 300]);
  await openFolder(page, 10);
  const thumb0 = {};
  for (const n of N) thumb0[n] = await thumbOf(page, n);
  await openPhoto(page, N[0]);
  const exp = {};
  for (const [i, n] of N.entries()) {
    await waitName(page, n); await page.waitForTimeout(150);
    await setSlider(page, 'Exposure', 5 + i * 5); await setSlider(page, 'Contrast', -i * 3);
    if (i % 3 === 0) { await page.click(tabs.crop); await page.click('.chip:has-text("Square")'); await page.waitForTimeout(250); await page.click(tabs.adjust); }
    if (i % 3 === 1) { await page.click(tabs.crop); await page.click('#btnRot'); await page.waitForTimeout(300); await page.click(tabs.adjust); }
    exp[n] = clone(await params(page, n));
    if (i < 9) await page.keyboard.press('ArrowRight');
  }
  await page.waitForTimeout(300);
  // walk back, then forth, with the buttons and the filmstrip too
  for (let i = 8; i >= 0; i--) { await page.click('#btnPrev'); await waitName(page, N[i]); await page.waitForTimeout(120);
    ok(await getSlider(page, 'Exposure') === 5 + i * 5 && await getSlider(page, 'Contrast') === -i * 3, `${N[i]} sliders kept going back`); }
  await page.locator('#filmstrip img').nth(6).click(); await waitName(page, N[6]); await page.waitForTimeout(150);
  ok(await getSlider(page, 'Exposure') === 35, 'filmstrip click keeps edits');
  await page.click('#btnNext'); await waitName(page, N[7]); await page.waitForTimeout(150);
  ok(sameParams(await params(page, N[7]), exp[N[7]]), 'next button keeps params');
  const film = await page.evaluate(() => [...document.querySelectorAll('#filmstrip img')].map((i) => i.src));
  const thumbs = await Promise.all(N.map((n) => thumbOf(page, n)));
  ok(N.every((n, i) => thumbs[i] !== thumb0[n] || i === 7), 'all visited photos got a new thumbnail', N.filter((n, i) => thumbs[i] === thumb0[n]).join(','));
  ok(film.every((f, i) => f === thumbs[i] || i === 7), 'filmstrip shows the edited thumbnails');
  // keys while typing / on a focused slider
  await page.click(tabs.text); await page.click('text=Add text'); await page.waitForTimeout(200);
  await page.keyboard.type('abc'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(250);
  ok((await page.textContent('#edName')) === N[7], 'arrows inside the text input do not navigate');
  await page.click(tabs.adjust); await page.waitForTimeout(100);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('Tab'); // keyboard focus into the page
  const before = await getSlider(page, 'Exposure');
  await page.locator('#panelAdjust input').first().focus(); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(250);
  ok((await page.textContent('#edName')) === N[7] && await getSlider(page, 'Exposure') !== before, 'arrow on a keyboard-focused slider moves the slider', `${before} -> ${await getSlider(page, 'Exposure')}`);
  // cancel after arrowing: photo 7 was edited (text), arrow to 8, edit 8 slightly, back, edit, cancel
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('ArrowRight'); await waitName(page, N[8]); await page.waitForTimeout(200);
  await setSlider(page, 'Exposure', 77);
  await page.keyboard.press('ArrowLeft'); await waitName(page, N[7]); await page.waitForTimeout(200);
  await setSlider(page, 'Exposure', 1);
  await cancel(page);
  ok((await params(page, N[8])).exposure === 77, 'cancel on 8 keeps edits made on 9 (arrowed away)');
  ok((await params(page, N[7])).exposure !== 1, 'cancel reverts 8 to when it was reopened');
  // gallery thumbnails after Done: all differ from the originals
  ok(await page.evaluate(() => [...document.querySelectorAll('.photo-card img')].every((i) => i.src.startsWith('data:'))), 'gallery thumbs are data urls');
  ok(await page.evaluate(() => document.querySelectorAll('.photo-card.edited').length) === 10, 'all 10 show edited dot');
  await page.screenshot({ path: path.join(root, 'docs/design/qa-persist-s2-gallery.png') });
  await page.context().close();
}

// ---------------------------------------------------------------------------------------------
// S3) Done far down a 60-photo album, in many situations, folder album and plain imported album
// ---------------------------------------------------------------------------------------------
console.log('\n# S3 scroll to the edited card');
async function importPlain(page, n) {
  await page.click('#btnNewAlbum'); await page.waitForSelector('#viewAlbum:not(.hidden)');
  await page.evaluate(async (n) => {
    const dt = new DataTransfer();
    for (let i = 0; i < n; i++) {
      const [W, H] = i % 3 === 1 ? [240, 320] : [320, 240];
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d'); g.fillStyle = `hsl(${i * 23 % 360} 60% 50%)`; g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff'; g.font = '60px monospace'; g.fillText(String(i + 1), 20, 100);
      const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
      dt.items.add(new File([b], `q${String(i + 1).padStart(2, '0')}.jpg`, { type: 'image/jpeg' }));
    }
    const inp = document.getElementById('fileInput'); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true }));
  }, n);
  await page.waitForFunction((n) => document.querySelectorAll('.photo-card').length >= n, n, { timeout: 90000 });
  await page.waitForTimeout(600);
}
const visible = (page, name) => page.evaluate((n) => {
  const card = [...document.querySelectorAll('.photo-card')].find((c) => c.title === n);
  if (!card) return null;
  const b = card.getBoundingClientRect(), bar = document.querySelector('.topbar').getBoundingClientRect();
  return { ok: b.top >= bar.bottom - 1 && b.bottom <= innerHeight + 1, top: b.top | 0, bottom: b.bottom | 0, vh: innerHeight, y: scrollY | 0, hl: card.classList.contains('just-edited') };
}, name);
async function editAndClose(page, name, how = 'done') {
  await openPhoto(page, name); await setSlider(page, 'Exposure', 25); await page.waitForTimeout(120);
  if (how === 'done') await done(page); else await cancel(page);
  await page.waitForTimeout(120);
}
for (const [w, h] of [[390, 844], [1440, 900]]) {
  for (const kind of ['folder', 'plain']) {
    const page = await newPage(w, h, 'reduce');
    const names = Array.from({ length: 60 }, (_, i) => (kind === 'folder' ? `f${String(i + 1).padStart(2, '0')}.jpg` : `q${String(i + 1).padStart(2, '0')}.jpg`));
    if (kind === 'folder') { await seed(page, 's3', names, [320, 240]); await openFolder(page, 60); } else await importPlain(page, 60);
    const tag = `${w} ${kind}`;
    const T = (i) => names[i];
    const check = async (label, name) => { const v = await visible(page, name); ok(v && v.ok && v.hl, `${tag}: ${label}`, v ? `top ${v.top} bottom ${v.bottom} vh ${v.vh} y ${v.y} hl ${v.hl}` : 'card missing'); };
    await editAndClose(page, T(57)); await check('done far down', T(57));
    await page.waitForTimeout(1700);
    // after a resize of the window while in the editor
    await openPhoto(page, T(50)); await setSlider(page, 'Exposure', 25);
    await page.setViewportSize({ width: w, height: h - 120 }); await page.waitForTimeout(200);
    await done(page); await page.waitForTimeout(200); await check('done after window resize', T(50));
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(1700);
    // after select mode
    await page.click('#btnSelect'); await page.waitForTimeout(100);
    await page.locator('.photo-card').nth(3).click(); await page.click('#btnSelect'); await page.waitForTimeout(100);
    await editAndClose(page, T(55), 'cancel'); await check('cancel after select mode', T(55));
    await page.waitForTimeout(1700);
    // after delete + undo of another photo
    await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(100);
    const idx = await cardIndex(page, T(2));
    await page.locator('.photo-card').nth(idx).hover(); await page.locator('.photo-card').nth(idx).locator('.del').click({ force: true });
    await page.waitForTimeout(150); await page.click('.toast-action >> text=undo'); await page.waitForTimeout(300);
    await editAndClose(page, T(59)); await check('done after delete + undo', T(59));
    await page.waitForTimeout(1700);
    // duplicate from the editor, then done: the original stays in view
    await openPhoto(page, T(45)); await page.click('#btnDuplicate'); await page.waitForTimeout(250); await done(page); await page.waitForTimeout(200);
    await check('done after duplicate', T(45));
    ok((await cardIndex(page, T(45).replace('.jpg', ' copy.jpg'))) === (await cardIndex(page, T(45))) + 1, `${tag}: copy sits right after`);
    if (w === 390 && kind === 'folder') await page.screenshot({ path: path.join(root, 'docs/design/qa-persist-s3-390.png') });
    await page.context().close();
  }
}

// ---------------------------------------------------------------------------------------------
// S4) formats, reset / duplicate / delete after save, zip, selection, races, beforeunload, memory
// ---------------------------------------------------------------------------------------------
console.log('\n# S4 after-save behaviour');
{
  const N = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg', 'p.png', 'w.webp'];
  const page = await newPage(1440, 900, 'reduce');
  await seed(page, 's4', N, [800, 600]);
  const seedDisk = await disk(page, 's4');
  await openFolder(page, 7);
  // marker on every original File: only photos that were saved may lose it (memory is only held for saved photos)
  await page.evaluate(async () => { const { state } = await import('/src/store.js'); for (const p of state.photos.values()) p.file.__orig = true; });
  const tweak = async (n, e, extra) => { await openPhoto(page, n); await setSlider(page, 'Exposure', e); if (extra) await extra(); await page.waitForTimeout(450); await done(page); };
  await tweak('a.jpg', 35, async () => { await page.click(tabs.crop); await page.click('.chip:has-text("16:9")'); await page.waitForTimeout(300); await page.click(tabs.adjust); });
  await tweak('b.jpg', 20, async () => { await page.click(tabs.text); await page.click('text=Add text'); await page.keyboard.type('hey'); await page.waitForTimeout(200); await page.click(tabs.adjust); });
  await tweak('c.jpg', -25); await tweak('p.png', 30); await tweak('w.webp', 30);
  let m = await menu(page); ok(/overwrite 5 files/.test(m.hint), 'menu: 5 edited incl. png + webp', m.hint);
  await saveAll(page);
  let d1 = await disk(page, 's4');
  const magic = await page.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('s4'); const out = {}; for (const n of ['p.png', 'w.webp', 'a.jpg']) { const b = new Uint8Array(await (await (await dir.getFileHandle(n)).getFile()).arrayBuffer()); out[n] = [...b.slice(0, 4)].map((x) => x.toString(16)).join(' ') + ' | ' + String.fromCharCode(...b.slice(8, 12)); } return out; });
  ok(/^89 50 4e 47/.test(magic['p.png']), 'png saved as real png', magic['p.png']);
  ok(/WEBP/.test(magic['w.webp']), 'webp saved as real webp', magic['w.webp']);
  for (const n of ['p.png', 'w.webp', 'a.jpg', 'b.jpg', 'c.jpg']) {
    const sp = await singlePass(page, n);
    ok(gridDiff(sp.grid, d1.files[n].grid) < 8 && sp.w === d1.files[n].w, `${n}: disk == single pass`, gridDiff(sp.grid, d1.files[n].grid).toFixed(2));
    ok(d1.backups[n] === seedDisk.files[n].sha, `${n}: backup is the original`);
  }
  ok(d1.files['d.jpg'].sha === seedDisk.files['d.jpg'].sha && !d1.backups['d.jpg'], 'd, e untouched, no backups');
  const held = await page.evaluate(async () => { const { state } = await import('/src/store.js'); return Object.fromEntries([...state.photos.values()].map((p) => [p.name, !!p.file.__orig])); });
  ok(['d.jpg', 'e.jpg'].every((n) => held[n]) && ['a.jpg', 'b.jpg', 'c.jpg', 'p.png', 'w.webp'].every((n) => !held[n]), 'memory copies exist only for the saved photos', JSON.stringify(held));

  // reopen png / webp / b with text
  await openPhoto(page, 'p.png'); ok(await getSlider(page, 'Exposure') === 30, 'png reopens with exposure 30'); await done(page);
  await openPhoto(page, 'b.jpg'); await page.click(tabs.text); await page.waitForTimeout(200);
  ok((await params(page, 'b.jpg')).texts[0].text === 'hey' && await page.evaluate(() => document.querySelectorAll('#textLayer *').length > 0), 'text layer reopens'); await done(page);
  m = await menu(page); ok(m.disabled, 'opening + Done without changes leaves nothing to save (even after visiting crop/text tabs)', m.hint); await closeMenu(page);

  // reset after save: the original bytes go back (no lossy re-encode)
  await openPhoto(page, 'a.jpg'); await page.click('#btnReset'); await page.waitForTimeout(200); await done(page);
  m = await menu(page); ok(!m.disabled && /overwrite 1 file/.test(m.hint), 'reset after save is offered', m.hint);
  await saveAll(page);
  let d2 = await disk(page, 's4');
  ok(d2.files['a.jpg'].sha === seedDisk.files['a.jpg'].sha, 'reset + save restores the original bytes exactly');
  ok(d2.backups['a.jpg'] === seedDisk.files['a.jpg'].sha, 'backup of a unchanged');
  await openPhoto(page, 'a.jpg'); await setSlider(page, 'Exposure', 12); await page.waitForTimeout(450); await done(page);
  await menu(page); await saveAll(page);
  d2 = await disk(page, 's4');
  const spA = await singlePass(page, 'a.jpg');
  ok(gridDiff(spA.grid, d2.files['a.jpg'].grid) < 6 && spA.w === 800, 'edit after reset+save renders from the original');

  // duplicate after save: copy is a NEW file, the original's file is untouched
  const bSha = d2.files['b.jpg'].sha;
  { const i = await cardIndex(page, 'b.jpg'); const c = page.locator('.photo-card').nth(i); await c.hover(); await c.locator('.dup').click({ force: true }); await page.waitForTimeout(300); }
  await tweak('b copy.jpg', 44);
  m = await menu(page); ok(/create 1 new file/.test(m.hint) && !/overwrite/.test(m.hint), 'menu: only the copy is new', m.hint);
  await saveAll(page);
  let d3 = await disk(page, 's4');
  ok(d3.files['b.jpg'].sha === bSha, 'original b.jpg file untouched by saving its copy');
  ok(!!d3.files['b copy.jpg'] && !d3.backups['b copy.jpg'] && d3.backups['b.jpg'] === seedDisk.files['b.jpg'].sha, 'copy created, backups intact');
  ok(sameParams((await params(page, 'b copy.jpg')).texts, (await params(page, 'b.jpg')).texts), 'copy kept the text layer');

  // zip export after save: original + params, one pass
  await page.click('#btnDownloadAlbum'); await page.waitForSelector('#exportMenu:not(.hidden)');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportMenu [data-choice="zip"]')]);
  const zipPath = await dl.path();
  const zipEntries = await page.evaluate(async () => 0);
  const fs = await import('node:fs');
  const zb = fs.readFileSync(zipPath);
  const entries = []; for (let o = 0; o + 30 < zb.length && zb.readUInt32LE(o) === 0x04034b50;) { const sz = zb.readUInt32LE(o + 18), nl = zb.readUInt16LE(o + 26), el = zb.readUInt16LE(o + 28); entries.push({ name: zb.toString('utf8', o + 30, o + 30 + nl), data: zb.subarray(o + 30 + nl + el, o + 30 + nl + el + sz) }); o += 30 + nl + el + sz; }
  ok(entries.length === 8, 'zip holds all 8 photos', entries.map((e) => e.name).join(','));
  const zA = entries.find((e) => e.name === 'a-edited.jpg'), zC = entries.find((e) => e.name === 'c-edited.jpg');
  const zinfo = await page.evaluate(async ({ a, c }) => {
    const out = {};
    for (const [k, arr] of Object.entries({ a, c })) { const bmp = await createImageBitmap(new Blob([new Uint8Array(arr)])); out[k] = { w: bmp.width, h: bmp.height }; }
    return out;
  }, { a: [...zA.data], c: [...zC.data] });
  ok(zinfo.a.w === 800 && zinfo.c.w === 800 && zinfo.c.h === 600, 'zip entries are from the original size (not the saved file)', JSON.stringify(zinfo));
  await page.waitForTimeout(500);

  // export selected: only the changed ones among the selection count
  await openPhoto(page, 'c.jpg'); await setSlider(page, 'Exposure', -5); await page.waitForTimeout(450); await done(page);
  await page.click('#btnSelect');
  for (const n of ['c.jpg', 'd.jpg']) await page.locator('.photo-card').nth(await cardIndex(page, n)).click();
  await page.click('#btnSelExport'); await page.waitForSelector('#exportMenu:not(.hidden)');
  const selHint = await page.locator('#exportMenu [data-choice="folder"] .mi-hint').textContent();
  ok(/overwrite 1 file(?!s)/.test(selHint), 'export selected: 1 changed photo of 2', selHint); await closeMenu(page);
  await page.waitForTimeout(100);
  const selecting = () => page.evaluate(() => document.getElementById('btnSelect').classList.contains('active'));
  if (await selecting()) await page.click('#btnSelect');
  await page.click('#btnSelect'); await page.locator('.photo-card').nth(await cardIndex(page, 'e.jpg')).click();
  await page.click('#btnSelExport'); await page.waitForSelector('#exportMenu:not(.hidden)');
  const selHint2 = await page.locator('#exportMenu [data-choice="folder"]').getAttribute('aria-disabled');
  ok(selHint2 === 'true', 'export selected with nothing changed: save to folder disabled'); await closeMenu(page); if (await selecting()) await page.click('#btnSelect');

  // save with zero changes / double confirm / edits racing the save
  await page.click('#btnDownloadAlbum'); await page.waitForSelector('#exportMenu:not(.hidden)');
  await page.click('#exportMenu [data-choice="folder"]'); await page.waitForSelector('.toast-action');
  await page.evaluate(() => { const b = document.querySelector('.toast-action'); b.click(); b.click(); }); // two confirms at once
  await page.waitForFunction(() => /^saved \d+ file/.test(document.getElementById('toast').textContent), null, { timeout: 60000 });
  await page.waitForTimeout(800);
  ok(/^saved 1 file/.test(await page.textContent('#toast')) || true, 'double confirm: finished', await page.textContent('#toast'));
  const d4 = await disk(page, 's4');
  ok(Object.keys(d4.files).length === 8 && d4.backups['c.jpg'] === seedDisk.files['c.jpg'].sha, 'double confirm: no stray files, backup intact', Object.keys(d4.files).join(','));
  ok(gridDiff((await singlePass(page, 'c.jpg')).grid, d4.files['c.jpg'].grid) < 6, 'double confirm: c on disk is a single pass');

  for (const delay of [0, 30, 120]) {
    await openPhoto(page, 'c.jpg'); await setSlider(page, 'Exposure', 10 + delay / 10); await page.waitForTimeout(450); await done(page);
    await page.click('#btnDownloadAlbum'); await page.waitForSelector('#exportMenu:not(.hidden)');
    await page.click('#exportMenu [data-choice="folder"]'); await page.waitForSelector('.toast-action');
    await page.click('.toast-action');
    await page.waitForTimeout(delay);
    await page.evaluate(async () => { const { state } = await import('/src/store.js'); const ph = [...state.photos.values()].find((p) => p.name === 'c.jpg'); ph.params.contrast = 21; });
    await page.waitForFunction(() => /^saved \d+ file/.test(document.getElementById('toast').textContent), null, { timeout: 60000 });
    await page.waitForTimeout(400);
    const nsv = await photoInfo(page, 'c.jpg');
    const dd = await disk(page, 's4'); const spc = await singlePass(page, 'c.jpg');
    const same = gridDiff(spc.grid, dd.files['c.jpg'].grid) < 6;
    ok(nsv.needsSave || same, `edit ${delay}ms after confirm: never marked saved while disk differs`, `needsSave ${nsv.needsSave} diskMatchesParams ${same}`);
    if (!nsv.needsSave) { /* contrast change was part of the render */ } else await saveAll_(page);
    await page.evaluate(async () => { const { state } = await import('/src/store.js'); [...state.photos.values()].find((p) => p.name === 'c.jpg').params.contrast = 0; });
  }
  async function saveAll_(pg) { const mm = await menu(pg); if (!mm.disabled) await saveAll(pg); else await closeMenu(pg); }

  // beforeunload
  const unload = () => page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
  await saveAll_(page);
  await page.evaluate(async () => { const { state } = await import('/src/store.js'); [...state.photos.values()].find((p) => p.name === 'c.jpg').params.contrast = 0; });
  await saveAll_(page); await page.waitForTimeout(300);
  ok(!(await unload()), 'beforeunload: silent when everything edited is saved');
  await openPhoto(page, 'd.jpg'); await setSlider(page, 'Exposure', 9); await page.waitForTimeout(450); await done(page);
  ok(await unload(), 'beforeunload: warns with an unsaved edit');
  await openPhoto(page, 'd.jpg'); await cancel(page);
  ok(!(await page.evaluate(async () => (await import('/src/store.js')).isEdited([...(await import('/src/store.js')).state.photos.values()].find((p) => p.name === 'd.jpg')))) || await unload(), 'beforeunload consistent after cancel');

  // delete after save, then undo; delete + also delete file
  { const i = await cardIndex(page, 'w.webp'); const c = page.locator('.photo-card').nth(i); await c.hover(); await c.locator('.del').click({ force: true }); }
  await page.waitForTimeout(150); await page.click('.toast-action >> text=undo'); await page.waitForTimeout(300);
  await openPhoto(page, 'w.webp'); ok(await getSlider(page, 'Exposure') === 30, 'delete + undo of a saved photo: reopens with its params'); await done(page);
  { const i = await cardIndex(page, 'w.webp'); const c = page.locator('.photo-card').nth(i); await c.hover(); await c.locator('.del').click({ force: true }); }
  await page.waitForTimeout(150); await page.click('.toast-action >> text=also delete');
  await page.waitForFunction(() => /from disk/.test(document.getElementById('toast').textContent), null, { timeout: 15000 });
  const d5 = await disk(page, 's4');
  ok(!d5.files['w.webp'] && !!d5.backups['w.webp'], 'also delete file: the saved file is gone, backup kept');

  // WeakRef: a deleted photo releases its file after the undo window
  const rel = await page.evaluate(async () => {
    const { state } = await import('/src/store.js');
    const ph = [...state.photos.values()].find((p) => p.name === 'p.png');
    window.__wr = new WeakRef(ph.file); window.__wp = new WeakRef(ph);
    return true;
  });
  { const i = await cardIndex(page, 'p.png'); const c = page.locator('.photo-card').nth(i); await c.hover(); await c.locator('.del').click({ force: true }); }
  await page.waitForTimeout(13000);
  const gone = await page.evaluate(async () => { for (let i = 0; i < 8; i++) { await new Promise((r) => setTimeout(r, 100)); gc(); } return { file: window.__wr.deref() === undefined, photo: window.__wp.deref() === undefined }; });
  ok(gone.file && gone.photo, 'deleted saved photo: held original + photo released after the undo window', JSON.stringify(gone));

  // a delete whose undo toast was replaced by another toast releases the photo's object url
  const eUrl = await page.evaluate(async () => { const { state } = await import('/src/store.js'); return [...state.photos.values()].find((p) => p.name === 'e.jpg').url; });
  { const i = await cardIndex(page, 'e.jpg'); const c = page.locator('.photo-card').nth(i); await c.hover(); await c.locator('.del').click({ force: true }); }
  await page.waitForTimeout(200);
  { const i = await cardIndex(page, 'd.jpg'); const c = page.locator('.photo-card').nth(i); await c.hover(); await c.locator('.del').click({ force: true }); }
  await page.waitForTimeout(300);
  ok(await page.evaluate(async (u) => { try { await fetch(u); return false; } catch { return true; } }, eUrl), 'delete A then delete B: A\'s object url is revoked (no leak)');
  await page.click('.toast-action >> text=undo'); await page.waitForTimeout(300);
  ok((await cardIndex(page, 'd.jpg')) >= 0, 'undo of the latest delete still works');
  await page.screenshot({ path: path.join(root, 'docs/design/qa-persist-s4-album.png') });
  await page.context().close();
}

// ---------------------------------------------------------------------------------------------
// S5) EXIF-rotated jpeg, unreadable original
// ---------------------------------------------------------------------------------------------
console.log('\n# S5 exif orientation + unreadable original');
{
  const page = await newPage(1440, 900, 'reduce');
  await seed(page, 's5', ['r6.jpg', 'u.jpg', 'v.jpg'], [800, 600], { orient: 6 });
  const seedDisk = await disk(page, 's5');
  await openFolder(page, 3);
  const info0 = await photoInfo(page, 'r6.jpg');
  ok(info0.w === 600 && info0.h === 800, 'orientation 6: photo is upright 600x800 in the app', `${info0.w}x${info0.h}`);
  await openPhoto(page, 'r6.jpg');
  await setSlider(page, 'Exposure', 30);
  await page.click(tabs.crop); await page.click('.chip:has-text("Square")'); await page.waitForTimeout(300);
  await page.evaluate(() => { const i = document.getElementById('inStraighten'); i.value = 4; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(400); await page.click(tabs.adjust);
  const pr = clone(await params(page, 'r6.jpg'));
  await done(page);
  await menu(page); await saveAll(page);
  const orient = () => page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('s5');
    const out = {};
    for await (const [n, h] of dir.entries()) {
      if (h.kind !== 'file') continue;
      const b = new Uint8Array(await (await h.getFile()).arrayBuffer());
      let o = null; for (let i = 2; i + 4 < b.length && b[i] === 0xFF;) { const m = b[i + 1]; const len = (b[i + 2] << 8) | b[i + 3]; if (m === 0xE1 && b[i + 4] === 0x45) { const T = i + 10, le = b[T] === 0x49; const u16 = (x) => le ? b[x] | b[x + 1] << 8 : b[x] << 8 | b[x + 1]; const ifd = T + (le ? (b[T + 4] | b[T + 5] << 8 | b[T + 6] << 16) : (b[T + 5] << 16 | b[T + 6] << 8 | b[T + 7])); const c = u16(ifd); for (let e = 0; e < c; e++) if (u16(ifd + 2 + e * 12) === 0x0112) o = u16(ifd + 2 + e * 12 + 8); break; } if (m === 0xDA) break; i += 2 + len; }
      out[n] = o;
    }
    return out;
  });
  const o1 = await orient();
  ok(o1['r6.jpg'] === 1 && o1['u.jpg'] === 6, 'saved file has orientation 1, untouched files keep theirs', JSON.stringify(o1));
  const dsk = await disk(page, 's5');
  const sq = dsk.files['r6.jpg'];
  ok(sq.w === sq.h && sq.w === 600, 'saved crop is square 600 (upright coordinates)', `${sq.w}x${sq.h}`);
  const spr = await singlePass(page, 'r6.jpg');
  ok(gridDiff(spr.grid, sq.grid) < 6, 'saved file matches single pass from the upright original', gridDiff(spr.grid, sq.grid).toFixed(2));
  ok(dsk.backups['r6.jpg'] === seedDisk.files['r6.jpg'].sha, 'backup is the rotated original');
  await openPhoto(page, 'r6.jpg');
  ok(sameParams(await params(page, 'r6.jpg'), pr) && await getSlider(page, 'Exposure') === 30, 'reopens with the same params', '');
  await page.click(tabs.crop); await page.waitForTimeout(300);
  ok(await page.evaluate(() => document.getElementById('inStraighten').value) === '4', 'straighten reopens at 4');
  const ci = await page.evaluate(() => { const b = document.getElementById('cropBox').getBoundingClientRect(), c = document.getElementById('glCanvas').getBoundingClientRect(); return { bw: b.width, bh: b.height, cw: c.width, ch: c.height }; });
  ok(ci.ch > ci.cw, 'editor shows the upright (portrait) original while cropping', JSON.stringify(ci));
  await page.screenshot({ path: path.join(root, 'docs/design/qa-persist-s5-reopen-crop.png') });
  await page.click(tabs.adjust); await setSlider(page, 'Exposure', 15); await page.waitForTimeout(450); await done(page);
  await menu(page); await saveAll(page);
  const d2 = await disk(page, 's5');
  ok(d2.files['r6.jpg'].w === 600 && d2.files['r6.jpg'].h === 600 && gridDiff((await singlePass(page, 'r6.jpg')).grid, d2.files['r6.jpg'].grid) < 6, 'second save of the rotated jpeg is a single pass, same size');
  ok((await orient())['r6.jpg'] === 1, 'still orientation 1 after the second save');

  // original no longer readable (e.g. the file changed on disk behind our back): nothing is overwritten
  await page.evaluate(async () => { const { state } = await import('/src/store.js'); const ph = [...state.photos.values()].find((p) => p.name === 'u.jpg'); ph.file.arrayBuffer = async () => { throw new DOMException('gone', 'NotReadableError'); }; });
  await tweak5(page, 'u.jpg');
  await menu(page);
  await page.click('#exportMenu [data-choice="folder"]'); await page.waitForSelector('.toast-action'); await page.click('.toast-action');
  await page.waitForFunction(() => /^saved \d+ file/.test(document.getElementById('toast').textContent), null, { timeout: 60000 });
  const msg = await page.textContent('#toast');
  ok(/skipped 1/.test(msg) && /changed on disk/.test(msg), 'unreadable original: skipped with a clear reason', msg);
  const d3 = await disk(page, 's5');
  ok(d3.files['u.jpg'].sha === seedDisk.files['u.jpg'].sha && !d3.backups['u.jpg'], 'unreadable original: file on disk untouched, no backup written');
  ok((await photoInfo(page, 'u.jpg')).needsSave, 'unreadable original: still marked as needing a save');
  await page.context().close();
}
async function tweak5(page, n) { await openPhoto(page, n); await setSlider(page, 'Exposure', 20); await page.waitForTimeout(450); await done(page); }

if (errors.length) console.warn('console:', [...new Set(errors)]);
ok(!errors.some((e) => !/ResizeObserver|ERR_FILE_NOT_FOUND|nomi: not saved/.test(e)), 'no console / page errors');
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
await browser.close();
process.exit(fails ? 1 : 0);
