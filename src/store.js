// Session-only store. No persistence by design.
export const DEFAULTS = {
  exposure: 0, brilliance: 0, highlights: 0, shadows: 0,
  contrast: 0, brightness: 0, blackpoint: 0,
  saturation: 0, vibrance: 0, warmth: 0, tint: 0,
};

export function defaultParams() {
  return {
    ...DEFAULTS,
    crop: { x: 0, y: 0, w: 1, h: 1 },
    rotation: 0, // 0,90,180,270
    straighten: 0, // -45..45 deg
    aspect: 'free',
    filter: 'original',
    filterAmount: 100,
    texts: [], // text layers (editor/text.js), source space
  };
}

export const state = {
  albums: new Map(), // id -> {id,name,photoIds:[],createdAt}
  photos: new Map(), // id -> {id,albumId,file,name,type,width,height,url,thumbUrl,bitmapW,bitmapH,params,dirty}
  activeAlbum: null,
  activePhoto: null,
};

export function uid(p = 'id') {
  return p + '_' + Math.random().toString(36).slice(2, 9);
}

export function isEdited(ph) {
  if (!ph) return false;
  const p = ph.params;
  for (const k of Object.keys(DEFAULTS)) if ((p[k] || 0) !== 0) return true;
  const c = p.crop;
  if (c.x !== 0 || c.y !== 0 || c.w !== 1 || c.h !== 1) return true;
  if (p.rotation !== 0 || p.straighten !== 0) return true;
  if (p.filter && p.filter !== 'original' && (p.filterAmount ?? 100) > 0) return true;
  if (Array.isArray(p.texts) && p.texts.some((t) => String(t.text || '').trim())) return true;
  return false;
}

// Stable text form of params (key order independent), to tell "same edit" from "changed".
export function paramsSig(p) {
  const sort = (v) => (Array.isArray(v) ? v.map(sort)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v);
  return JSON.stringify(sort(p));
}

// Would "save to folder" write this photo? Folder photos whose edit differs from what is on disk
// (ph.savedParams = params at the last save), plus copies that have no file yet.
export function needsSave(ph) {
  if (!ph || !ph.dir) return false;
  if (!ph.handle) return true;
  if (!ph.savedParams) return isEdited(ph);
  return paramsSig(ph.params) !== paramsSig(ph.savedParams);
}

export function clampCrop(c) {
  const x = Math.min(0.95, Math.max(0, c.x));
  const y = Math.min(0.95, Math.max(0, c.y));
  const w = Math.min(1 - x, Math.max(0.05, c.w));
  const h = Math.min(1 - y, Math.max(0.05, c.h));
  return { x, y, w, h };
}

// "a.jpg" -> "a copy.jpg" -> "a copy 2.jpg", skipping names already taken.
export function copyName(name, taken) {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  const stem = base.replace(/ copy(?: \d+)?$/, '');
  for (let n = 1; ; n++) {
    const candidate = `${stem} copy${n === 1 ? '' : ' ' + n}${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// Same file and edits, new id, inserted right after the original.
export function duplicatePhoto(id) {
  const src = state.photos.get(id);
  const album = src && state.albums.get(src.albumId);
  if (!album) return null;
  const taken = new Set(album.photoIds.map((pid) => state.photos.get(pid)?.name));
  const copy = { ...src, id: uid('ph'), name: copyName(src.name, taken), params: structuredClone(src.params), dirty: false };
  // A copy shares the folder but never the source's file handle: saving it creates a new file.
  delete copy.handle;
  delete copy.savedParams;
  delete copy.createdHere;
  state.photos.set(copy.id, copy);
  album.photoIds.splice(album.photoIds.indexOf(id) + 1, 0, copy.id);
  return copy;
}

// Remove from its album; returns what restorePhoto needs to undo it.
export function deletePhoto(id) {
  const ph = state.photos.get(id);
  const album = ph && state.albums.get(ph.albumId);
  if (!album) return null;
  const index = album.photoIds.indexOf(id);
  if (index >= 0) album.photoIds.splice(index, 1);
  state.photos.delete(id);
  if (state.activePhoto === id) state.activePhoto = null;
  return { photo: ph, index };
}

export function restorePhoto({ photo, index }) {
  const album = state.albums.get(photo.albumId);
  if (!album) return false;
  state.photos.set(photo.id, photo);
  album.photoIds.splice(Math.min(index, album.photoIds.length), 0, photo.id);
  return true;
}

// Object URLs are shared by duplicates, so only release one nobody references.
export function isUrlInUse(url) {
  for (const p of state.photos.values()) if (p.url === url) return true;
  return false;
}
