// Run the real save-to-folder flow on real photos, then write the saved bytes to a normal disk folder
// so Finder / Quick Look can be checked by eye.
// Usage: node scripts/finder-check.mjs <srcDir with >=4 jpegs> <outDir> [baseUrl]
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [src, out, base = 'http://localhost:8811'] = process.argv.slice(2);
const req = createRequire(import.meta.url);
let chromium;
for (const dir of [process.env.NOMI_PLAYWRIGHT, path.join(root, 'node_modules'), path.join(root, '../redsgn/node_modules')].filter(Boolean)) {
  try { ({ chromium } = req(req.resolve('playwright', { paths: [dir] }))); break; } catch {}
}
const files = readdirSync(src).filter((f) => /\.jpe?g$/i.test(f)).sort().slice(0, 4);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })).newPage();
await page.goto(`${base}/`, { waitUntil: 'load' });
await page.evaluate(async (list) => {
  const root = await navigator.storage.getDirectory();
  try { await root.removeEntry('real', { recursive: true }); } catch {}
  const dir = await root.getDirectoryHandle('real', { create: true });
  for (const [name, b64] of list) {
    const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
    await w.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))); await w.close();
  }
  window.showDirectoryPicker = async () => dir;
}, files.map((f) => [f, readFileSync(path.join(src, f)).toString('base64')]));

await page.click('#btnOpenFolder');
await page.waitForSelector('.photo-card >> nth=3'); await page.waitForTimeout(1200);
const edit = async (i, fn) => {
  await page.click(`.photo-card >> nth=${i}`); await page.waitForSelector('#viewEditor:not(.hidden)'); await page.waitForTimeout(800);
  await fn(); await page.click('#btnDone'); await page.waitForSelector('#viewAlbum:not(.hidden)'); await page.waitForTimeout(300);
};
await edit(0, () => page.evaluate(() => { for (const [l, v] of [['Exposure', -70], ['Saturation', -100]]) { const i = [...document.querySelectorAll('#panelAdjust .slider')].find((s) => s.textContent.includes(l)).querySelector('input'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); } }));
await edit(1, async () => { await page.click('#tabFilters'); await page.click('.filter >> nth=9'); await page.waitForTimeout(300); });
await edit(2, async () => { await page.click('#tabText'); await page.click('text=Add text'); await page.keyboard.type('EDITED'); await page.waitForTimeout(500); });
await edit(3, async () => { await page.click('#tabCrop'); await page.click('.chip:has-text("Square")'); await page.waitForTimeout(500); });

await page.click('#btnDownloadAlbum'); await page.waitForSelector('#exportMenu:not(.hidden)');
await page.click('#exportMenu [data-choice="folder"]'); await page.waitForSelector('.toast-action'); await page.click('.toast-action');
await page.waitForFunction(() => /^saved \d+ file/.test(document.getElementById('toast').textContent), null, { timeout: 120000 });
console.log(await page.textContent('#toast'));

const saved = await page.evaluate(async () => {
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('real'); const res = [];
  for await (const [name, h] of dir.entries()) if (h.kind === 'file') {
    const u = new Uint8Array(await (await h.getFile()).arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); res.push([name, btoa(s)]);
  }
  return res;
});
mkdirSync(out, { recursive: true });
for (const [n, b64] of saved) writeFileSync(path.join(out, n), Buffer.from(b64, 'base64'));
console.log('wrote', saved.map(([n]) => n).join(', '), '->', out);
await browser.close();
