// E2E: open folder -> edit (adjust, filter, text, crop, rotate) -> save to folder -> check the files on disk
// -> reload and reopen the same folder -> check the edits survived.
// The folder is a real File System Access directory (OPFS) handed to the app through a patched showDirectoryPicker.
// Usage: python3 -m http.server 8811 &  node scripts/test-folder-save.mjs [baseUrl]
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

// Photo size in px, e.g. SIZE=6000x4000 to mimic a 24MP camera file.
const SIZE = (process.env.SIZE || '800x600').split('x').map(Number);
let fails = 0;
const ok = (c, m, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}${x ? ' — ' + x : ''}`); if (!c) fails++; };

const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('nomi:')) errors.push(m.text()); });

await page.goto(`${base}/`, { waitUntil: 'load' });

// Seed an OPFS folder "trip" with colourful 800x600 jpegs and make showDirectoryPicker return it.
await page.evaluate(async (SIZE) => {
  const root = await navigator.storage.getDirectory();
  try { await root.removeEntry('trip', { recursive: true }); } catch {}
  const dir = await root.getDirectoryHandle('trip', { create: true });
  for (const n of ['a-adjust', 'b-filter', 'c-text', 'd-crop', 'e-rotate']) {
    const c = document.createElement('canvas'); c.width = SIZE[0]; c.height = SIZE[1];
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, SIZE[0], SIZE[1]);
    gr.addColorStop(0, '#d9604a'); gr.addColorStop(0.5, '#3fa7c4'); gr.addColorStop(1, '#f6b45a');
    g.fillStyle = gr; g.fillRect(0, 0, SIZE[0], SIZE[1]);
    g.fillStyle = '#2a8f4e'; g.fillRect(SIZE[0] * .12, SIZE[1] * .63, SIZE[0] * .37, SIZE[1] * .3);
    let blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95));
    // Like a camera or phone file: an Exif block with the pixel size and a small preview of the picture (IFD1).
    const t = document.createElement('canvas'); t.width = 160; t.height = Math.round(160 * SIZE[1] / SIZE[0]);
    t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
    const thumb = new Uint8Array(await (await new Promise((r) => t.toBlob(r, 'image/jpeg', 0.8))).arrayBuffer());
    const le = (v, n) => Array.from({ length: n }, (_, k) => (v >>> (8 * k)) & 255);
    const ent = (tag, type, cnt, val) => [...le(tag, 2), ...le(type, 2), ...le(cnt, 4), ...le(val, 4)];
    const tiff = [0x49, 0x49, 42, 0, 8, 0, 0, 0,
      ...le(2, 2), ...ent(0x0112, 3, 1, 1), ...ent(0x8769, 4, 1, 38), ...le(68, 4),              // IFD0 -> IFD1 at 68
      ...le(2, 2), ...ent(0xA002, 4, 1, SIZE[0]), ...ent(0xA003, 4, 1, SIZE[1]), ...le(0, 4),     // Exif IFD at 38
      ...le(2, 2), ...ent(0x0201, 4, 1, 98), ...ent(0x0202, 4, 1, thumb.length), ...le(0, 4),     // IFD1 at 68
      ...thumb];
    const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    const app1 = new Uint8Array([0xFF, 0xE1, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload]);
    const jb = new Uint8Array(await blob.arrayBuffer());
    blob = new Blob([jb.subarray(0, 2), app1, jb.subarray(2)], { type: 'image/jpeg' });
    const w = await (await dir.getFileHandle(`${n}.jpg`, { create: true })).createWritable();
    await w.write(blob); await w.close();
  }
  window.showDirectoryPicker = async () => dir;
}, SIZE);

// Stats of every image in the folder, measured by decoding the real bytes on disk.
const readFolder = () => page.evaluate(async () => {
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('trip');
  const out = {};
  const stats = async (file) => {
    const bmp = await createImageBitmap(file);
    const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
    let r = 0, gg = 0, b = 0, sat = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * 7) {
      r += d[i]; gg += d[i + 1]; b += d[i + 2];
      sat += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]); n++;
    }
    // centre patch fingerprint (for text)
    const t = new OffscreenCanvas(32, 24).getContext('2d'); t.drawImage(c, 0, 0, 32, 24);
    const td = t.getImageData(0, 0, 32, 24).data; const grid = []; for (let i = 0; i < td.length; i += 4) grid.push(td[i] + td[i + 1] + td[i + 2]);
    // Embedded Exif preview (what Finder / Quick Look / Photos show as the icon) and declared pixel size.
    const bytes = new Uint8Array(await file.arrayBuffer());
    let thumbLum = null, exifW = null;
    let at = 2; while (at + 4 < bytes.length && bytes[at] === 0xFF && bytes[at + 1] !== 0xE1 && bytes[at + 1] !== 0xDA) at += 2 + ((bytes[at + 2] << 8) | bytes[at + 3]);
    if (bytes[at] === 0xFF && bytes[at + 1] === 0xE1) {
      const len = (bytes[at + 2] << 8) | bytes[at + 3], seg = bytes.subarray(at, at + 2 + len);
      for (let i = 14; i + 3 < seg.length; i++) if (seg[i] === 0xFF && seg[i + 1] === 0xD8 && seg[i + 2] === 0xFF) {
        try { const tb = await createImageBitmap(new Blob([seg.subarray(i)], { type: 'image/jpeg' })); const tg = new OffscreenCanvas(tb.width, tb.height).getContext('2d'); tg.drawImage(tb, 0, 0); const td2 = tg.getImageData(0, 0, tb.width, tb.height).data; let q = 0, m = 0; for (let k = 0; k < td2.length; k += 4) { q += td2[k] + td2[k + 1] + td2[k + 2]; m++; } thumbLum = q / 3 / m; } catch {}
        break;
      }
      const le2 = seg[10] === 0x49, rd = (o, nb) => { let v = 0; for (let k = 0; k < nb; k++) v |= seg[o + (le2 ? k : nb - 1 - k)] << (8 * k); return v >>> 0; };
      const ifd0 = 10 + rd(14, 4), cnt = rd(ifd0, 2);
      for (let e = 0; e < cnt; e++) { const p = ifd0 + 2 + e * 12; if (rd(p, 2) === 0x8769) { const ex = 10 + rd(p + 8, 4); if (rd(ex + 2, 2) === 0xA002) exifW = rd(ex + 2 + 8, 4); } }
    }
    return { w: bmp.width, h: bmp.height, lum: (r + gg + b) / 3 / n, sat: sat / n, grid, thumbLum, exifW };
  };
  for await (const [name, h] of dir.entries()) if (h.kind === 'file') out[name] = { ...(await stats(await h.getFile())), size: (await h.getFile()).size };
  let backups = [];
  try { const bd = await dir.getDirectoryHandle('.nomi-originals'); for await (const [name] of bd.entries()) backups.push(name); } catch {}
  out.__backups = backups.sort();
  return out;
});

const before = await readFolder();
ok(Object.keys(before).filter((k) => k.endsWith('.jpg')).length === 5, 'seeded 5 jpegs');

// --- open folder
await page.click('#btnOpenFolder');
await page.waitForSelector('.photo-card >> nth=4');
await page.waitForTimeout(800);

const open = async (name) => {
  const idx = await page.evaluate((n) => [...document.querySelectorAll('.photo-card')].findIndex((c) => c.textContent.includes(n) || c.querySelector('.nm')?.textContent === n), name);
  await page.click(`.photo-card >> nth=${idx < 0 ? 0 : idx}`);
  await page.waitForSelector('#viewEditor:not(.hidden)');
  await page.waitForTimeout(500);
};
const done = async () => { await page.click('#btnDone'); await page.waitForSelector('#viewAlbum:not(.hidden)'); await page.waitForTimeout(300); };

// photo order = sorted by name: a b c d e
// a: adjust (exposure up, saturation down)
await open('a-adjust');
await page.evaluate(() => {
  const set = (label, v) => { const i = [...document.querySelectorAll('#panelAdjust .slider')].find((s) => s.textContent.includes(label)).querySelector('input'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); };
  set('Exposure', 60); set('Saturation', -100);
});
await done();
// b: filter noir
await page.click('.photo-card >> nth=1'); await page.waitForSelector('#viewEditor:not(.hidden)'); await page.waitForTimeout(500);
await page.click('#tabFilters'); await page.click('.filter >> nth=9'); await page.waitForTimeout(300);
await done();
// c: text
await page.click('.photo-card >> nth=2'); await page.waitForSelector('#viewEditor:not(.hidden)'); await page.waitForTimeout(500);
await page.click('#tabText'); await page.click('text=Add text'); await page.waitForTimeout(300);
await page.keyboard.type('HELLO NOMI');
await page.waitForTimeout(500);
await done();
// d: crop square
await page.click('.photo-card >> nth=3'); await page.waitForSelector('#viewEditor:not(.hidden)'); await page.waitForTimeout(500);
await page.click('#tabCrop'); await page.click('.chip:has-text("Square")'); await page.waitForTimeout(500);
await done();
// e: rotate 90
await page.click('.photo-card >> nth=4'); await page.waitForSelector('#viewEditor:not(.hidden)'); await page.waitForTimeout(500);
await page.click('#tabCrop'); await page.click('#btnRot'); await page.waitForTimeout(400);
await done();

// --- save to folder
await page.click('#btnDownloadAlbum');
await page.waitForSelector('#exportMenu:not(.hidden)');
const hint = await page.textContent('#exportMenu [data-choice="folder"] .mi-hint');
ok(/overwrite 5 files/.test(hint), 'export menu offers to overwrite 5 files', hint);
await page.click('#exportMenu [data-choice="folder"]');
await page.waitForSelector('.toast-action');
await page.click('.toast-action');
await page.waitForFunction(() => /^saved \d+ file/.test(document.getElementById('toast').textContent), null, { timeout: 60000 });
console.log('toast:', await page.textContent('#toast'));

const after = await readFolder();
const A = (n) => [before[n], after[n]];
let [o, s] = A('a-adjust.jpg');
ok(s.lum > o.lum + 5, 'adjust: exposure persisted (brighter on disk)', `${o.lum.toFixed(1)} -> ${s.lum.toFixed(1)}`);
ok(s.sat < o.sat * 0.25, 'adjust: saturation -100 persisted', `${o.sat.toFixed(1)} -> ${s.sat.toFixed(1)}`);
[o, s] = A('b-filter.jpg');
ok(s.sat < o.sat * 0.25, 'filter: noir persisted (desaturated on disk)', `${o.sat.toFixed(1)} -> ${s.sat.toFixed(1)}`);
[o, s] = A('c-text.jpg');
const changed = o.grid.filter((v, i) => Math.abs(v - s.grid[i]) > 30).length;
ok(changed > 5, 'text: pixels changed on disk', `${changed} of 768 cells differ`);
[o, s] = A('d-crop.jpg');
ok(s.w === s.h && s.w < o.w, 'crop: square on disk', `${o.w}x${o.h} -> ${s.w}x${s.h}`);
[o, s] = A('e-rotate.jpg');
ok(s.w === o.h && s.h === o.w, 'rotate: 90° on disk', `${o.w}x${o.h} -> ${s.w}x${s.h}`);
// The Exif preview must not show the old picture, and the declared size must match the file.
for (const n of ['a-adjust.jpg', 'b-filter.jpg', 'c-text.jpg', 'd-crop.jpg', 'e-rotate.jpg']) {
  ok(before[n].thumbLum != null, `${n}: seed has an Exif preview`);
  ok(after[n].thumbLum == null || Math.abs(after[n].thumbLum - after[n].lum) < 15, `${n}: no stale Exif preview`, `preview lum ${after[n].thumbLum?.toFixed(1)} vs image ${after[n].lum.toFixed(1)}`);
  ok(after[n].exifW === after[n].w, `${n}: Exif PixelXDimension matches the file`, `${after[n].exifW} vs ${after[n].w}`);
}
ok(JSON.stringify(after.__backups) === JSON.stringify(Object.keys(before).filter((k) => k.endsWith('.jpg')).sort()), 'originals backed up in .nomi-originals', after.__backups.join(','));

// --- delete: nomi only (ignore the question) vs also from disk
const names = () => page.evaluate(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('trip'); const n = []; for await (const [k, h] of d.entries()) if (h.kind === 'file') n.push(k); return n.sort(); });
await page.click('.photo-card >> nth=0'); await page.waitForSelector('#viewEditor:not(.hidden)'); await page.click('#btnBackAlbum'); await page.waitForSelector('#viewAlbum:not(.hidden)');
await page.hover('.photo-card >> nth=0'); await page.click('.photo-card >> nth=0 >> .del');
const q = await page.textContent('#toast');
ok(/removed a-adjust\.jpg from the album · the file is still on disk/.test(q), 'toast says the file is still on disk and offers to delete it', q);
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(root, 'docs/design/delete-question-1440.png') });
await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(200);
await page.screenshot({ path: path.join(root, 'docs/design/delete-question-390.png') });
await page.setViewportSize({ width: 1440, height: 900 });
ok((await names()).includes('a-adjust.jpg'), 'file stays on disk until you confirm');
await page.click('.toast-action:has-text("undo")');
ok(await page.locator('.photo-card').count() === 5, 'undo brings the photo back');
await page.hover('.photo-card >> nth=0'); await page.click('.photo-card >> nth=0 >> .del');
await page.click('.toast-action:has-text("also delete")');
await page.waitForFunction(() => /from disk$/.test(document.getElementById('toast').textContent), null, { timeout: 10000 });
const left = await names();
ok(!left.includes('a-adjust.jpg') && left.length === 4, 'delete from disk removes the file', left.join(','));
ok(await page.locator('.photo-card').count() === 4, 'photo is gone from the album');
// multi-select delete: two files at once
await page.click('#btnSelect'); await page.click('.photo-card >> nth=0'); await page.click('.photo-card >> nth=1'); await page.click('#btnSelDelete');
ok(/removed 2 photos from the album · files are still on disk/.test(await page.textContent('#toast')), 'multi delete asks once for 2 files', await page.textContent('#toast'));
await page.click('.toast-action:has-text("also delete")');
await page.waitForFunction(() => /2 files from disk$/.test(document.getElementById('toast').textContent), null, { timeout: 10000 });
ok((await names()).length === 2, 'both files removed', (await names()).join(','));
await page.screenshot({ path: path.join(root, 'docs/design/delete-from-disk-1440.png') });

// --- reload and reimport
await page.reload({ waitUntil: 'load' });
await page.evaluate(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('trip'); window.showDirectoryPicker = async () => d; });
await page.click('#btnOpenFolder');
await page.waitForSelector('.photo-card >> nth=1');
await page.waitForTimeout(800);
const reimport = await page.evaluate(() => [...document.querySelectorAll('.photo-card img')].map((i) => ({ w: i.naturalWidth, h: i.naturalHeight })));
ok(reimport.length === 2, 'reimport shows the 2 remaining photos', String(reimport.length));
const reread = await readFolder();
ok(Object.keys(reread).filter((k) => k.endsWith('.jpg')).length === 2 && JSON.stringify(reread.__backups) === JSON.stringify(after.__backups), 'reimport changes nothing on disk; backups kept');
// After a reload the saved files are the new starting point (settings are session-only; see test-persist-edits.mjs).
await page.screenshot({ path: path.join(root, 'docs/design/folder-reimport-1440.png') });

if (errors.length) { console.warn('console:', [...new Set(errors)]); }
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
await browser.close();
process.exit(fails ? 1 : 0);
