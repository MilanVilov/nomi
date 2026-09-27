// Full-res export + STORE-only ZIP writer. Vanilla ES module, zero deps.
import { createEngine } from './editor/gl.js';
import { ensureFonts } from './editor/textsprite.js';

let CRC_TABLE = null;
export function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosNow() {
  const d = new Date();
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((Math.floor(d.getSeconds() / 2)) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time: time & 0xffff, date: date & 0xffff };
}

// STORE-only zip: local headers + central directory + EOCD. Filenames UTF-8.
export function storeZip(files) {
  if (!Array.isArray(files)) throw new Error('No files to zip.');
  const enc = new TextEncoder();
  const { time, date } = dosNow();
  const metas = files.map((f) => {
    if (!f || typeof f.name !== 'string' || !(f.data instanceof Uint8Array)) {
      throw new Error('Bad zip entry — each file needs {name, data}.');
    }
    const nameBytes = enc.encode(f.name);
    if (nameBytes.length > 0xffff) throw new Error(`Filename too long: "${f.name}".`);
    return { nameBytes, data: f.data, crc: crc32(f.data), size: f.data.length };
  });
  const n = metas.length;
  let localSize = 0, centralSize = 0;
  for (const m of metas) { localSize += 30 + m.nameBytes.length + m.size; centralSize += 46 + m.nameBytes.length; }
  const out = new Uint8Array(localSize + centralSize + 22);
  const v = new DataView(out.buffer);
  let off = 0;
  const offsets = [];
  for (const m of metas) {
    offsets.push(off);
    v.setUint32(off, 0x04034b50, true); off += 4;
    v.setUint16(off, 20, true); off += 2;
    v.setUint16(off, 0x0800, true); off += 2; // UTF-8
    v.setUint16(off, 0, true); off += 2; // method STORE
    v.setUint16(off, time, true); off += 2;
    v.setUint16(off, date, true); off += 2;
    v.setUint32(off, m.crc, true); off += 4;
    v.setUint32(off, m.size, true); off += 4;
    v.setUint32(off, m.size, true); off += 4;
    v.setUint16(off, m.nameBytes.length, true); off += 2;
    v.setUint16(off, 0, true); off += 2;
    out.set(m.nameBytes, off); off += m.nameBytes.length;
    out.set(m.data, off); off += m.size;
  }
  const centralOff = off;
  for (let i = 0; i < n; i++) {
    const m = metas[i];
    v.setUint32(off, 0x02014b50, true); off += 4;
    v.setUint16(off, 788, true); off += 2; // made by unix
    v.setUint16(off, 20, true); off += 2;
    v.setUint16(off, 0x0800, true); off += 2;
    v.setUint16(off, 0, true); off += 2;
    v.setUint16(off, time, true); off += 2;
    v.setUint16(off, date, true); off += 2;
    v.setUint32(off, m.crc, true); off += 4;
    v.setUint32(off, m.size, true); off += 4;
    v.setUint32(off, m.size, true); off += 4;
    v.setUint16(off, m.nameBytes.length, true); off += 2;
    v.setUint16(off, 0, true); off += 2;
    v.setUint16(off, 0, true); off += 2;
    v.setUint16(off, 0, true); off += 2;
    v.setUint16(off, 0, true); off += 2;
    v.setUint32(off, 0, true); off += 4;
    v.setUint32(off, offsets[i], true); off += 4;
    out.set(m.nameBytes, off); off += m.nameBytes.length;
  }
  v.setUint32(off, 0x06054b50, true); off += 4;
  v.setUint16(off, 0, true); off += 2;
  v.setUint16(off, 0, true); off += 2;
  v.setUint16(off, n, true); off += 2;
  v.setUint16(off, n, true); off += 2;
  v.setUint32(off, centralSize, true); off += 4;
  v.setUint32(off, centralOff, true); off += 4;
  v.setUint16(off, 0, true); off += 2;
  return new Blob([out], { type: 'application/zip' });
}

function clampCrop(c) {
  const x = Math.min(0.95, Math.max(0, c.x || 0));
  const y = Math.min(0.95, Math.max(0, c.y || 0));
  const w = Math.min(1 - x, Math.max(0.05, c.w == null ? 1 : c.w));
  const h = Math.min(1 - y, Math.max(0.05, c.h == null ? 1 : c.h));
  return { x, y, w, h };
}

function normRot(r) {
  const s = ((Math.round((r || 0) / 90) % 4) + 4) % 4;
  return s * 90;
}

function outNameFor(orig, mime) {
  const base = String(orig || 'photo.jpg').split('/').pop().split('\\').pop() || 'photo.jpg';
  const dot = base.lastIndexOf('.');
  if (dot > 0) return base.slice(0, dot) + '-edited' + base.slice(dot);
  return base + '-edited' + (mime === 'image/png' ? '.png' : '.jpg');
}

function isPngPhoto(photo) {
  const t = photo.type || (photo.file && photo.file.type) || '';
  if (t === 'image/png') return true;
  return /\.png$/i.test(photo.name || (photo.file && photo.file.name) || '');
}

async function decodeFull(file, label) {
  if (!file) throw new Error(`Could not export "${label}" — original file is missing, re-import it.`);
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch { /* fall through to fallback */ }
    try {
      return await createImageBitmap(file);
    } catch { /* fall through */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const el = new Image();
      el.onload = () => res(el);
      el.onerror = () => rej(new Error('decode'));
      el.src = url;
    });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || 1; c.height = img.naturalHeight || 1;
    c.getContext('2d').drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    return img;
  } catch {
    try { URL.revokeObjectURL(url); } catch {}
    throw new Error(`Could not decode "${label}" — file may be corrupt or unsupported.`);
  }
}

function toBlobP(canvas, mime, quality) {
  return new Promise((res, rej) => {
    try {
      canvas.toBlob(
        (b) => (b ? res(b) : rej(new Error('Export failed — canvas is empty, try a smaller crop.'))),
        mime, quality ?? (mime === 'image/jpeg' ? 1.0 : undefined),
      );
    } catch (e) { rej(new Error('Export failed — ' + (e && e.message || e))); }
  });
}

function renderFallback2D(canvas, bmp, p, outW, outH) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Export failed — no 2D canvas available.');
  ctx.save();
  try { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; } catch {}
  ctx.clearRect(0, 0, outW, outH);
  try {
    ctx.filter = `brightness(${(1 + (p.exposure || 0) * 0.01 + (p.brightness || 0) * 0.005).toFixed(3)}) contrast(${(1 + (p.contrast || 0) * 0.008).toFixed(3)}) saturate(${(1 + (p.saturation || 0) * 0.012).toFixed(3)})`;
  } catch {}
  const bw = bmp.width || bmp.naturalWidth, bh = bmp.height || bmp.naturalHeight;
  const sx = Math.max(0, Math.min(bw - 1, Math.round(bw * p.crop.x)));
  const sy = Math.max(0, Math.min(bh - 1, Math.round(bh * p.crop.y)));
  const sw = Math.max(1, Math.min(bw - sx, Math.round(bw * p.crop.w)));
  const sh = Math.max(1, Math.min(bh - sy, Math.round(bh * p.crop.h)));
  const steps = ((Math.round((p.rotation || 0) / 90) % 4) + 4) % 4;
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate(steps * Math.PI / 2);
  const dw = steps % 2 === 0 ? outW : outH;
  const dh = steps % 2 === 0 ? outH : outW;
  ctx.drawImage(bmp, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
  try { ctx.filter = 'none'; } catch {}
}

// opts.mime / opts.quality override the ZIP defaults (used when saving back in the original format).
export async function renderFullRes(photo, engineFactory, opts = {}) {
  if (!photo || !photo.file) throw new Error('Could not export photo — original file is missing, re-import it.');
  const label = photo.name || 'photo';
  const crop = clampCrop((photo.params && photo.params.crop) || { x: 0, y: 0, w: 1, h: 1 });
  const rotation = normRot(photo.params && photo.params.rotation);
  const mime = opts.mime || (isPngPhoto(photo) ? 'image/png' : 'image/jpeg');
  const outName = outNameFor(label, mime);
  let bmp = null;
  try {
    bmp = await decodeFull(photo.file, label);
  } catch (e) { throw e instanceof Error ? e : new Error(`Could not decode "${label}".`); }
  const bw = bmp.width || bmp.naturalWidth, bh = bmp.height || bmp.naturalHeight;
  if (!bw || !bh) { try { bmp.close && bmp.close(); } catch {} throw new Error(`Could not decode "${label}" — file may be corrupt or unsupported.`); }
  const cw = Math.max(1, Math.round(bw * crop.w));
  const ch = Math.max(1, Math.round(bh * crop.h));
  const swap = rotation === 90 || rotation === 270;
  const outW = swap ? ch : cw, outH = swap ? cw : ch;
  const canvas = document.createElement('canvas');
  canvas.width = outW; canvas.height = outH;
  const p = { ...(photo.params || {}), crop, rotation };
  const makeEngine = engineFactory || createEngine;
  const texts = Array.isArray(p.texts) ? p.texts : [];
  if (texts.length) await ensureFonts(texts); // never bake a fallback font into the file
  let usedGL = false;
  try {
    const engine = makeEngine(canvas);
    if (engine && engine.gl) {
      engine.setImage(bmp, Math.max(bw, bh)); // full-res upload (scale 1)
      canvas.width = outW; canvas.height = outH; // setImage resizes; restore export size
      engine.gl.viewport(0, 0, outW, outH);
      engine.render(p); // same shader as preview: crop+rotation+straighten
      if (engine.renderTexts) engine.renderTexts(texts, p); // text layers at full resolution
      usedGL = true;
    }
  } catch { usedGL = false; }
  try {
    if (!usedGL) { canvas.width = outW; canvas.height = outH; renderFallback2D(canvas, bmp, p, outW, outH); }
  } catch (e) { try { bmp.close && bmp.close(); } catch {} throw e instanceof Error ? e : new Error(`Could not render "${label}".`); }
  try { bmp.close && bmp.close(); } catch {}
  const blob = await toBlobP(canvas, mime, opts.quality).catch((e) => {
    throw new Error(`Could not encode "${label}" — ${e && e.message || e}`);
  });
  return { blob, outName };
}

// onProgress({ done, total, name }) fires after each photo is rendered.
export async function exportAlbumZip(album, photos, onProgress) {
  if (!photos || !photos.length) throw new Error('Nothing to export — import photos first.');
  if (typeof document === 'undefined') throw new Error('Export needs a browser — open Nomi over http.');
  const files = [];
  for (const ph of photos) {
    let r;
    try { r = await renderFullRes(ph); }
    catch (e) { throw new Error(`Could not export "${(ph && ph.name) || 'photo'}" — ${(e && e.message) || e}`); }
    let name = r.outName;
    for (let n = 2; files.some((f) => f.name === name); n++) name = r.outName.replace(/(\.[^.]*)?$/, ` (${n})$1`);
    files.push({ name, data: new Uint8Array(await r.blob.arrayBuffer()) });
    if (onProgress) onProgress({ done: files.length, total: photos.length, name });
    await new Promise((r2) => setTimeout(r2, 0)); // yield between photos
  }
  let zip;
  try { zip = storeZip(files); }
  catch (e) { throw new Error('Could not build ZIP — ' + ((e && e.message) || e)); }
  const base = (((album && album.name) || 'album').trim() || 'album').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80) || 'album';
  const url = URL.createObjectURL(zip);
  try {
    const a = document.createElement('a');
    a.href = url; a.download = base + '.zip';
    document.body.appendChild(a); a.click(); a.remove();
  } catch (e) { try { URL.revokeObjectURL(url); } catch {} throw new Error('Download was blocked — allow downloads and retry.'); }
  setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} }, 10000);
  return zip;
}
