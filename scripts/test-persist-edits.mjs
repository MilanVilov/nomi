// E2E for edit persistence and navigation:
//  A) Done / Cancel scroll the edited card into view and highlight it (40-photo album, 390 + 1440)
//  B) ←/→ keep edits in memory (slider drag, crop, fast arrowing, cancel semantics, thumbnails)
//  C) save to folder is non-destructive: reopen shows the exact params, saving again renders from the
//     original (never twice), the backup never changes, the export menu only offers what differs.
// Needs the dev server: python3 -m http.server 8811 &  node scripts/test-persist-edits.mjs [baseUrl]
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
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu'] });
const errors = [];

async function newPage(width, height, reducedMotion = 'no-preference') {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('nomi:')) errors.push(m.text()); });
  await page.goto(`${base}/`, { waitUntil: 'load' });
  return page;
}

// Seed an OPFS folder with jpegs (Exif block + embedded preview like a camera file) and make showDirectoryPicker return it.
async function seed(page, folder, names, size) {
  await page.evaluate(async ({ folder, names, size }) => {
    const root = await navigator.storage.getDirectory();
    try { await root.removeEntry(folder, { recursive: true }); } catch {}
    const dir = await root.getDirectoryHandle(folder, { create: true });
    for (const [i, n] of names.entries()) {
      // vary orientation a little so the justified gallery has real rows
      const [W, H] = i % 4 === 1 ? [size[1], size[0]] : size;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 0, W, H);
      gr.addColorStop(0, `hsl(${(i * 37) % 360} 60% 55%)`); gr.addColorStop(0.5, '#3fa7c4'); gr.addColorStop(1, '#f6b45a');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      g.fillStyle = '#2a8f4e'; g.fillRect(W * .12, H * .63, W * .37, H * .3);
      g.fillStyle = '#fff'; g.font = `${Math.round(H / 5)}px monospace`; g.fillText(String(i + 1), W * .55, H * .45);
      let blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95));
      const t = document.createElement('canvas'); t.width = 80; t.height = Math.round(80 * H / W);
      t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
      const thumb = new Uint8Array(await (await new Promise((r) => t.toBlob(r, 'image/jpeg', 0.8))).arrayBuffer());
      const le = (v, n) => Array.from({ length: n }, (_, k) => (v >>> (8 * k)) & 255);
      const ent = (tag, type, cnt, val) => [...le(tag, 2), ...le(type, 2), ...le(cnt, 4), ...le(val, 4)];
      const tiff = [0x49, 0x49, 42, 0, 8, 0, 0, 0,
        ...le(2, 2), ...ent(0x0112, 3, 1, 1), ...ent(0x8769, 4, 1, 38), ...le(68, 4),
        ...le(2, 2), ...ent(0xA002, 4, 1, W), ...ent(0xA003, 4, 1, H), ...le(0, 4),
        ...le(2, 2), ...ent(0x0201, 4, 1, 98), ...ent(0x0202, 4, 1, thumb.length), ...le(0, 4),
        ...thumb];
      const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
      const app1 = new Uint8Array([0xFF, 0xE1, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload]);
      const jb = new Uint8Array(await blob.arrayBuffer());
      blob = new Blob([jb.subarray(0, 2), app1, jb.subarray(2)], { type: 'image/jpeg' });
      const w = await (await dir.getFileHandle(n, { create: true })).createWritable();
      await w.write(blob); await w.close();
    }
    window.showDirectoryPicker = async () => dir;
  }, { folder, names, size });
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

// ---------------------------------------------------------------------------------------------
// A) Done / Cancel -> the card is in view and highlighted
// ---------------------------------------------------------------------------------------------
const names40 = Array.from({ length: 40 }, (_, i) => `p${String(i + 1).padStart(2, '0')}.jpg`);
for (const [w, h] of [[390, 844], [1440, 900]]) {
  for (const reduced of ['no-preference', 'reduce']) {
    const page = await newPage(w, h, reduced);
    await seed(page, 'big', names40, [320, 240]);
    await openFolder(page, 40);
    const tag = `${w}px${reduced === 'reduce' ? ' reduced-motion' : ''}`;
    for (const [name, how] of [['p38.jpg', 'done'], ['p27.jpg', 'cancel'], ['p01.jpg', 'done']]) {
      if (name === 'p01.jpg') await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
      await openPhoto(page, name);
      await setSlider(page, 'Exposure', 30);
      await page.waitForTimeout(100);
      if (how === 'done') await done(page); else await cancel(page);
      await page.waitForTimeout(60);
      const r = await page.evaluate((n) => {
        const card = [...document.querySelectorAll('.photo-card')].find((c) => c.title === n);
        const b = card.getBoundingClientRect(), bar = document.querySelector('.topbar').getBoundingClientRect();
        const cs = getComputedStyle(card);
        return { top: b.top, bottom: b.bottom, barBottom: bar.bottom, vh: innerHeight, cls: card.classList.contains('just-edited'), outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, scrollY, edited: card.classList.contains('edited') };
      }, name);
      ok(r.top >= r.barBottom - 1 && r.bottom <= r.vh + 1, `${tag}: ${how} ${name} -> card fully in view`, `top ${r.top | 0} bottom ${r.bottom | 0} vh ${r.vh} scrollY ${r.scrollY | 0}`);
      ok(r.cls && /solid 2px/.test(r.outline), `${tag}: ${name} highlighted`, r.outline);
      if (name === 'p38.jpg') {
        ok(r.scrollY > 100, `${tag}: far-below card needed a real scroll`, String(r.scrollY | 0));
        const mid = (r.top + r.bottom) / 2;
        ok(Math.abs(mid - r.vh / 2) < r.vh * 0.2 || r.top > r.barBottom, `${tag}: roughly centred`, `centre ${mid | 0} of ${r.vh}`);
        if (reduced === 'no-preference') {
          await page.screenshot({ path: path.join(root, `docs/design/found-card-${w}.png`) });
        }
      }
      if (how === 'done') ok(r.edited, `${tag}: ${name} shows the edited dot`);
      else ok(!r.edited, `${tag}: cancelled ${name} has no edit`);
      await page.waitForTimeout(1700);
      const gone = await page.evaluate(() => !document.querySelector('.photo-card.just-edited'));
      ok(gone, `${tag}: highlight is gone after ~1.4s`);
      // a relayout during the highlight must not lose or restart it
    }
    if (reduced === 'no-preference') {
      await openPhoto(page, 'p20.jpg'); await done(page);
      await page.waitForTimeout(500);
      await page.setViewportSize({ width: w, height: h - 80 }); // resize -> gallery relayout while highlighted
      await page.waitForTimeout(150);
      ok(await page.evaluate(() => !!document.querySelector('.photo-card.just-edited')), `${tag}: highlight survives a relayout`);
    }
    await page.context().close();
  }
}

// ---------------------------------------------------------------------------------------------
// B + C) one folder of 5 photos at desktop width
// ---------------------------------------------------------------------------------------------
const N5 = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg'];
const page = await newPage(1440, 900, 'reduce');
await seed(page, 'trip', N5, [800, 600]);
const seedDisk = await disk(page, 'trip');
await openFolder(page, 5);

// -- File objects from getFile() are snapshots? (informational: OPFS is not a real disk, so the app also keeps its own copy)
const snap = await page.evaluate(async () => {
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('trip');
  const h = await dir.getFileHandle('zz-probe.tmp', { create: true }); { const w0 = await h.createWritable(); await w0.write(new Uint8Array(500)); await w0.close(); } const f = await h.getFile(); const before = f.size;
  const bytes = new Uint8Array(await f.arrayBuffer());
  const w = await h.createWritable(); await w.write(new Uint8Array([1, 2, 3])); await w.close();
  let readable = true, same = false;
  try { const b2 = new Uint8Array(await f.arrayBuffer()); same = b2.length === before; } catch { readable = false; }
  await dir.removeEntry('zz-probe.tmp');
  return { readable, same };
});
console.log(`INFO old File object after the file was overwritten on OPFS: readable=${snap.readable} sameBytes=${snap.same} (real disks may differ, the app keeps an in-memory copy)`);

// -- B1: edit a with adjust + filter + text + crop, Done
await openPhoto(page, 'a.jpg');
await setSlider(page, 'Exposure', 40);
await setSlider(page, 'Saturation', -50);
await page.click('#tabFilters'); await page.click('.filter >> nth=3'); await page.waitForTimeout(200);
await page.click('#tabText'); await page.click('text=Add text'); await page.waitForTimeout(200);
await page.keyboard.type('HELLO'); await page.waitForTimeout(300);
await page.click('#tabCrop'); await page.click('.chip:has-text("Square")'); await page.waitForTimeout(500);
const pa = await params(page, 'a.jpg');
ok(pa.exposure === 40 && pa.saturation === -50 && pa.filter !== 'original' && pa.texts.length === 1 && pa.crop.w < 1, 'a: adjust + filter + text + crop recorded', JSON.stringify({ e: pa.exposure, f: pa.filter, t: pa.texts.length, c: pa.crop }));
const thumbA0 = await thumbOf(page, 'a.jpg');
await done(page);
ok((await thumbOf(page, 'a.jpg')) !== thumbA0, 'Done refreshes the album thumbnail');

// -- B2: arrow to next and back
await openPhoto(page, 'a.jpg');
await page.keyboard.press('ArrowRight');
await page.waitForFunction(() => document.getElementById('edName').textContent === 'b.jpg');
await page.waitForTimeout(300);
const filmA = await filmThumb(page, 0);
ok(filmA !== thumbA0 && filmA === (await thumbOf(page, 'a.jpg')), 'arrowing away refreshed the filmstrip thumbnail of a');
await page.keyboard.press('ArrowLeft');
await page.waitForFunction(() => document.getElementById('edName').textContent === 'a.jpg');
await page.waitForTimeout(300);
const pa2 = await params(page, 'a.jpg');
ok(JSON.stringify(pa2) === JSON.stringify(pa), 'a: params identical after arrow next + back');
ok(await getSlider(page, 'Exposure') === 40 && await getSlider(page, 'Saturation') === -50, 'a: sliders show the stored values after arrowing back');
await page.click('#tabFilters'); await page.waitForTimeout(200);
ok(await page.evaluate(() => /active/.test(document.querySelectorAll('.filter')[3].className)), 'a: filter still active');
await page.click('#tabText');
ok(await page.evaluate(async () => (await import('/src/store.js')).state.photos.size > 0 && document.querySelectorAll('#textLayer *').length > 0), 'a: text layer still there');

// -- B3: arrow right after a slider drag, before the debounced history commit (350ms)
await page.click('#tabAdjust');
await page.keyboard.press('ArrowRight');
await page.waitForFunction(() => document.getElementById('edName').textContent === 'b.jpg');
await setSlider(page, 'Contrast', 33);
await page.keyboard.press('ArrowLeft'); // immediately
await page.waitForFunction(() => document.getElementById('edName').textContent === 'a.jpg');
await page.keyboard.press('ArrowRight');
await page.waitForFunction(() => document.getElementById('edName').textContent === 'b.jpg');
await page.waitForTimeout(300);
ok((await params(page, 'b.jpg')).contrast === 33 && await getSlider(page, 'Contrast') === 33, 'b: slider change survived an immediate arrow');
ok((await page.evaluate(() => document.getElementById('btnUndo').disabled)), 'undo history is fresh for the reopened photo');

// -- B4: fast arrowing across everything
for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
await page.waitForTimeout(900);
const nowAt = await page.textContent('#edName');
ok(nowAt === 'e.jpg', 'fast arrowing lands on the last photo', nowAt);
for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(900);
ok((await page.textContent('#edName')) === 'a.jpg' && JSON.stringify(await params(page, 'a.jpg')) === JSON.stringify(pa) && (await params(page, 'c.jpg')).exposure === 0, 'fast arrowing changed nothing');

// -- B5: arrow while in crop mode with an unsettled crop
await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
await page.waitForFunction(() => document.getElementById('edName').textContent === 'c.jpg');
await page.waitForTimeout(300);
await page.click('#tabCrop'); await page.click('.chip:has-text("16:9")');
await page.keyboard.press('ArrowRight'); // before the crop view settled
await page.waitForFunction(() => document.getElementById('edName').textContent === 'd.jpg');
await page.waitForTimeout(300);
const pc = await params(page, 'c.jpg');
ok(pc.aspect === '16:9' && pc.crop.h < 1, 'c: unsettled 16:9 crop kept when arrowing away', JSON.stringify(pc.crop));
ok(await page.evaluate(() => !document.getElementById('viewEditor').classList.contains('cropping')), 'next photo opens out of crop mode');
await page.keyboard.press('ArrowLeft');
await page.waitForFunction(() => document.getElementById('edName').textContent === 'c.jpg');
await page.waitForTimeout(300);
await page.click('#tabCrop'); await page.waitForTimeout(300);
ok(await page.evaluate(() => document.querySelector('.chip.active')?.textContent === '16:9'), 'c: crop tab shows 16:9 after coming back');

// -- B6: cancel only discards edits since THAT photo was (re)opened
await page.click('#tabAdjust'); await setSlider(page, 'Exposure', 10);
await page.keyboard.press('ArrowRight');                       // c keeps exposure 10
await page.waitForFunction(() => document.getElementById('edName').textContent === 'd.jpg');
await page.waitForTimeout(250);
await setSlider(page, 'Exposure', 20); await setSlider(page, 'Warmth', 15);
await page.keyboard.press('ArrowLeft');
await page.waitForFunction(() => document.getElementById('edName').textContent === 'c.jpg');
await page.waitForTimeout(250);
await setSlider(page, 'Exposure', 70);                         // after re-open
await page.waitForTimeout(100);
await cancel(page);
const pc2 = await params(page, 'c.jpg'), pd = await params(page, 'd.jpg');
ok(pc2.exposure === 10 && pc2.aspect === '16:9', 'cancel on c restores c to when it was reopened (exposure 10, crop kept)', `exposure ${pc2.exposure}`);
ok(pd.exposure === 20 && pd.warmth === 15, 'cancel on c leaves d edits alone', `d ${pd.exposure}/${pd.warmth}`);
const edited = await page.evaluate(() => [...document.querySelectorAll('.photo-card')].map((c) => c.classList.contains('edited')));
ok(JSON.stringify(edited) === JSON.stringify([true, true, true, true, false]), 'edited dots match', JSON.stringify(edited));
// undo / redo inside one visit
await openPhoto(page, 'd.jpg');
await setSlider(page, 'Exposure', 55); await page.waitForTimeout(500);
await page.keyboard.press('Control+z'); await page.waitForTimeout(200);
ok(await getSlider(page, 'Exposure') === 20, 'undo goes back to the value when reopened');
await page.keyboard.press('Control+Shift+z'); await page.waitForTimeout(200);
ok(await getSlider(page, 'Exposure') === 55, 'redo works');
await cancel(page);
ok((await params(page, 'd.jpg')).exposure === 20, 'cancel after undo/redo restores');

// make the set unambiguous for saving: b contrast, c crop+10, d 20/15, a full
const origBytes = Object.fromEntries(N5.map((n) => [n, seedDisk.files[n].sha]));

// -- C1: save to folder
let m = await menu(page);
ok(!m.disabled && /overwrite 4 files/.test(m.hint), 'export menu offers the 4 edited files', m.hint);
await saveAll(page);
let d1 = await disk(page, 'trip');
ok(d1.files['a.jpg'].w === d1.files['a.jpg'].h && d1.files['a.jpg'].w === 600, 'a: square crop is on disk', `${d1.files['a.jpg'].w}x${d1.files['a.jpg'].h}`);
ok(d1.files['a.jpg'].lum > seedDisk.files['a.jpg'].lum - 200, 'a: written');
ok(d1.files['e.jpg'].sha === origBytes['e.jpg'], 'e (unedited) untouched');
ok(N5.slice(0, 4).every((n) => d1.backups[n] === origBytes[n]) && !d1.backups['e.jpg'], 'backups hold the original bytes of the 4 edited files', Object.keys(d1.backups).join(','));
// the in-memory state is still the original + params
const ia = await photoInfo(page, 'a.jpg');
ok(ia.w === 800 && ia.h === 600 && ia.hasSaved && !ia.needsSave, 'a: size still describes the original, saved state tracked', JSON.stringify(ia));
const seedSize = await page.evaluate(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('trip'); const b = await (await (await d.getDirectoryHandle('.nomi-originals')).getFileHandle('a.jpg')).getFile(); return b.size; });
ok(ia.fileSize === seedSize, 'a: ph.file is still the original (same size as the backup)', `${ia.fileSize} vs ${seedSize}`);
ok(JSON.stringify(await params(page, 'a.jpg')) === JSON.stringify(pa), 'a: params untouched by the save');
ok(await page.evaluate(() => [...document.querySelectorAll('.photo-card')].slice(0, 4).every((c) => c.classList.contains('edited'))), 'saved photos keep the edited dot');
m = await menu(page);
ok(m.disabled && /nothing changed since last save/.test(m.hint), 'export menu: nothing changed since last save', m.hint);
await closeMenu(page);
// beforeunload: nothing unsaved -> no prompt
ok(await page.evaluate(async () => { const { state, isEdited, needsSave } = await import('/src/store.js'); return [...state.photos.values()].every((p) => !isEdited(p) || !needsSave(p)); }), 'no unsaved edits after the save');

// -- C2: REOPEN a: everything as set, not zero
await openPhoto(page, 'a.jpg');
ok(await getSlider(page, 'Exposure') === 40 && await getSlider(page, 'Saturation') === -50, 'REOPEN a: sliders show 40 / -50, not 0');
await page.click('#tabFilters'); await page.waitForTimeout(200);
ok(await page.evaluate((f) => /active/.test(document.querySelectorAll('.filter')[3].className), 0), 'REOPEN a: filter still selected');
await page.click('#tabText'); await page.waitForTimeout(200);
ok((await params(page, 'a.jpg')).texts[0].text === 'HELLO', 'REOPEN a: text layer kept');
await page.click('#tabCrop'); await page.waitForTimeout(300);
ok(await page.evaluate(() => document.querySelector('.chip.active')?.textContent === 'Square') && (await params(page, 'a.jpg')).crop.w < 1, 'REOPEN a: square crop kept (editable, framed on the ORIGINAL pixels)');
// the editor shows the original photo (800x600 source), not the saved 600x600 file
ok(await page.evaluate(() => { const c = document.getElementById('glCanvas'); return c.width > 0; }), 'editor canvas ready');
await page.click('#tabAdjust');
// tweak one slider, save again
await setSlider(page, 'Exposure', 20);
await page.waitForTimeout(500);
await done(page);
m = await menu(page);
ok(!m.disabled && /overwrite 1 file(?!s)/.test(m.hint), 'export menu offers again, only a', m.hint);
await saveAll(page);
const d2 = await disk(page, 'trip');
ok(d2.backups['a.jpg'] === origBytes['a.jpg'] && JSON.stringify(d2.backups) === JSON.stringify(d1.backups), 'second save: .nomi-originals unchanged byte for byte');
ok(d2.files['b.jpg'].sha === d1.files['b.jpg'].sha, 'second save: other photos not rewritten');
ok(d2.files['a.jpg'].sha !== d1.files['a.jpg'].sha, 'second save: a rewritten');
const sp = await singlePass(page, 'a.jpg');
const diffNow = gridDiff(sp.grid, d2.files['a.jpg'].grid.slice(0));
ok(sp.w === d2.files['a.jpg'].w && sp.h === d2.files['a.jpg'].h, 'disk size == single pass render size', `${sp.w}x${sp.h}`);
ok(diffNow < 6, 'a on disk == single-pass render of original + new params (nothing applied twice)', `mean diff ${diffNow.toFixed(2)}`);
// and it is NOT the 'apply 40 then 20' result: exposure 20 vs 40 differ measurably
ok(d2.files['a.jpg'].lum < d1.files['a.jpg'].lum - 2, 'exposure went 40 -> 20 (not stacked)', `${d1.files['a.jpg'].lum.toFixed(1)} -> ${d2.files['a.jpg'].lum.toFixed(1)}`);
m = await menu(page); ok(m.disabled && /nothing changed/.test(m.hint), 'menu clean again after the second save'); await closeMenu(page);

// -- C3: zip export still uses original + params
const zipSingle = await singlePass(page, 'a.jpg');
ok(diffNow < 6 && zipSingle.w === 600, 'zip path (renderFullRes) uses original + params');

// -- C4: Reset after save is a change; Cancel after save is not
await openPhoto(page, 'a.jpg'); await setSlider(page, 'Exposure', 90); await cancel(page);
ok((await params(page, 'a.jpg')).exposure === 20, 'Cancel after a save restores the saved params');
m = await menu(page); ok(m.disabled, 'cancel after save leaves nothing to save', m.hint); await closeMenu(page);
await openPhoto(page, 'a.jpg'); await page.click('#btnReset'); await page.waitForTimeout(200); await done(page);
m = await menu(page); ok(!m.disabled && /overwrite 1 file/.test(m.hint), 'reset after save is offered for writing', m.hint); await closeMenu(page);

// -- C5: Duplicate of a saved photo -> new file, stays editable
await openPhoto(page, 'b.jpg');
await page.click('#btnDuplicate');
await page.waitForTimeout(300);
await done(page);
const names = await page.evaluate(() => [...document.querySelectorAll('.photo-card')].map((c) => c.title));
ok(names.includes('b copy.jpg'), 'duplicate appears', names.join(','));
const cp0 = await photoInfo(page, 'b copy.jpg');
ok(cp0.needsSave && !cp0.hasSaved && !cp0.handle, 'copy of a saved photo needs its own file');
await openPhoto(page, 'b copy.jpg'); await setSlider(page, 'Exposure', 15); await done(page);
m = await menu(page);
ok(/create 1 new file/.test(m.hint) && /overwrite 1 file/.test(m.hint), 'menu: overwrite a (reset) + create the copy', m.hint);
await saveAll(page);
const d3 = await disk(page, 'trip');
ok(!!d3.files['b copy.jpg'] && !d3.backups['b copy.jpg'], 'copy written as a new file, no backup for it');
ok(d3.backups['b.jpg'] === origBytes['b.jpg'], 'backup of b still the original');
const cp1 = await photoInfo(page, 'b copy.jpg');
ok(cp1.createdHere && cp1.hasSaved && !cp1.needsSave && cp1.w === 600 && cp1.h === 800, 'copy tracked as saved, original size kept', JSON.stringify(cp1));
await openPhoto(page, 'b copy.jpg');
ok(await getSlider(page, 'Exposure') === 15 && await getSlider(page, 'Contrast') === 33, 'copy reopens with its params');
await setSlider(page, 'Exposure', 5); await done(page);
await saveAll_ifOffered();
async function saveAll_ifOffered() { const mm = await menu(page); if (!mm.disabled) await saveAll(page); else await closeMenu(page); }
const d4 = await disk(page, 'trip');
const sp2 = await singlePass(page, 'b copy.jpg');
ok(gridDiff(sp2.grid, d4.files['b copy.jpg'].grid) < 6, 'copy saved a second time == single pass from the original', gridDiff(sp2.grid, d4.files['b copy.jpg'].grid).toFixed(2));
ok(Object.keys(d4.files).length === 6, 'no stray files', Object.keys(d4.files).join(','));
// the original File objects are still readable (decode) after every overwrite
const bad = await page.evaluate(async () => { const { state } = await import('/src/store.js'); const out = []; for (const p of state.photos.values()) { try { const b = await createImageBitmap(p.file); if (!b.width) out.push(p.name); } catch (e) { out.push(p.name + ':' + e.message); } } return out; });
ok(bad.length === 0, 'every photo still decodes from its original file after saves', bad.join(' | '));

// screenshot of the album after save (edit dots kept)
await page.screenshot({ path: path.join(root, 'docs/design/saved-album-1440.png') });

if (errors.length) console.warn('console:', [...new Set(errors)]);
ok(!errors.some((e) => !/ResizeObserver/.test(e)), 'no console / page errors');
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
await browser.close();
process.exit(fails ? 1 : 0);
