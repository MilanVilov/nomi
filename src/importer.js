import { state, uid, defaultParams } from './store.js';
import { thumbSize } from './editor/cropmath.js';

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|bmp|heic|heif|tiff?)$/i;

// Browsers sometimes report an empty type (e.g. iPhone HEIC), so fall back to the extension.
export function looksLikeImage(file) {
  return (file.type || '').startsWith('image/') || (!file.type && IMAGE_EXT.test(file.name || ''));
}

// Reason shown to the user when a file can't be decoded by this browser.
export function skipReason(file) {
  return /\.(heic|heif)$/i.test(file.name || '') || /hei[cf]/i.test(file.type || '')
    ? 'HEIC, unsupported in this browser — try Safari'
    : 'could not be decoded';
}

// onProgress({ done, total, id, name }) fires after each file is handled (added or skipped).
// Returns { added: [ids], skipped: [{ name, reason }] }.
// handleOf(file) -> { handle, dir } for photos opened from a folder (enables save in place).
export async function importFiles(albumId, fileList, onProgress, handleOf) {
  const album = state.albums.get(albumId);
  if (!album) throw new Error('no album');
  const all = [...fileList];
  const files = all.filter(looksLikeImage);
  const skipped = all.filter((f) => !looksLikeImage(f)).map((f) => ({ name: f.name, reason: 'not an image' }));
  if (!files.length) throw new Error('No images found — choose JPG, PNG, WebP or GIF files.');
  const added = [];
  let done = 0;
  for (const file of files) {
    const url = URL.createObjectURL(file);
    let w = 0, h = 0;
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      w = bmp.width; h = bmp.height;
      bmp.close();
    } catch {
      const dims = await probeSize(url);
      w = dims.w; h = dims.h;
    }
    done++;
    if (!w || !h) {
      // Undecodable: skip rather than add a broken tile.
      URL.revokeObjectURL(url);
      skipped.push({ name: file.name, reason: skipReason(file) });
      if (onProgress) onProgress({ done, total: files.length, id: null, name: file.name });
      continue;
    }
    const thumbUrl = await makeThumb(file, url);
    const id = uid('ph');
    state.photos.set(id, {
      id, albumId, file, name: file.name || 'photo.jpg',
      type: file.type || 'image/jpeg', width: w, height: h,
      url, thumbUrl, params: defaultParams(), dirty: false,
      ...(handleOf ? handleOf(file) : null),
    });
    album.photoIds.push(id);
    added.push(id);
    if (onProgress) onProgress({ done, total: files.length, id, name: file.name });
    // yield to keep UI alive on big batches
    await new Promise(r => setTimeout(r, 0));
  }
  return { added, skipped };
}

function probeSize(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = url;
  });
}

async function makeThumb(file, url) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const t = thumbSize(bmp.width, bmp.height, 640); // 2x for retina grids
    const c = document.createElement('canvas');
    c.width = t.w;
    c.height = t.h;
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    try { bmp.close(); } catch {}
    return c.toDataURL('image/jpeg', 0.72);
  } catch {
    return url;
  }
}

export function revokePhoto(ph) {
  try { URL.revokeObjectURL(ph.url); } catch {}
}
