// Save edits back over the original files (File System Access API: Chrome / Edge only).
// Photos opened with "open folder" keep a file handle; the first overwrite copies the untouched
// original into .nomi-originals/ next to it. Nothing is remembered between sessions.
import { renderFullRes } from './exporter.js';
import { copyExif } from './exif.js';
import { looksLikeImage } from './importer.js';
import { isEdited } from './store.js';

export const BACKUP_DIR = '.nomi-originals';

export function supportsFolders() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

// Formats the browser can encode, so they can be written back as the same type.
const WRITABLE = {
  jpg: { mime: 'image/jpeg', quality: 0.95 },
  jpeg: { mime: 'image/jpeg', quality: 0.95 },
  png: { mime: 'image/png' },
  webp: { mime: 'image/webp', quality: 0.95 },
};

export function formatFor(name) {
  const m = /\.([^.]+)$/.exec(name || '');
  return (m && WRITABLE[m[1].toLowerCase()]) || null;
}

// Top-level images of a folder the user picks (read + write). Dotfiles and backups are ignored.
export async function openFolder() {
  const dir = await window.showDirectoryPicker({ mode: 'readwrite', id: 'nomi' });
  const entries = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== 'file' || name.startsWith('.')) continue;
    const file = await handle.getFile();
    if (looksLikeImage(file)) entries.push({ file, handle });
  }
  entries.sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true }));
  return { name: dir.name, dir, entries };
}

// Must run inside a user gesture the first time (Chrome shows its own permission prompt).
export async function ensurePermission(dir) {
  const opts = { mode: 'readwrite' };
  if ((await dir.queryPermission(opts)) === 'granted') return true;
  return (await dir.requestPermission(opts)) === 'granted';
}

async function hasFile(dir, name) {
  try { await dir.getFileHandle(name); return true; } catch { return false; }
}

// Copy the original once; an existing backup is kept, so it always holds the true original.
export async function backupOriginal(dir, name, file) {
  const backups = await dir.getDirectoryHandle(BACKUP_DIR, { create: true });
  if (await hasFile(backups, name)) return false;
  const w = await (await backups.getFileHandle(name, { create: true })).createWritable();
  await w.write(file);
  await w.close();
  return true;
}

// A new file (e.g. a duplicate) must not land on an existing one: "a copy.jpg" -> "a copy 2.jpg".
async function freeName(dir, name) {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
  let candidate = name;
  for (let n = 2; await hasFile(dir, candidate); n++) candidate = `${base} ${n}${ext}`;
  return candidate;
}

// Render the photo at full resolution and write it into its folder.
// Returns { status: 'saved' | 'created', file, handle } or { status: 'skipped', reason }.
export async function saveInPlace(photo) {
  if (!photo.dir) return { status: 'skipped', reason: 'not opened from a folder' };
  const fmt = formatFor(photo.name);
  if (!fmt) return { status: 'skipped', reason: "format can't be written back — use zip" };
  // Read everything from the original before anything on disk changes.
  // Nothing edited (e.g. reset after a save): put the original bytes back instead of a lossy re-encode.
  let bytes;
  if (!isEdited(photo)) bytes = new Uint8Array(await photo.file.arrayBuffer());
  else {
    const { blob } = await renderFullRes(photo, undefined, fmt);
    bytes = new Uint8Array(await blob.arrayBuffer());
    if (fmt.mime === 'image/jpeg') bytes = copyExif(new Uint8Array(await photo.file.arrayBuffer()), bytes);
  }
  let handle = photo.handle, status = 'saved';
  if (handle && !photo.createdHere) {
    await backupOriginal(photo.dir, handle.name, photo.file);
  } else if (!handle) {
    handle = await photo.dir.getFileHandle(await freeName(photo.dir, photo.name), { create: true });
    status = 'created';
  }
  // createWritable writes to a swap file and replaces the original only on close().
  const w = await handle.createWritable();
  await w.write(bytes);
  await w.close();
  return { status, file: await handle.getFile(), handle };
}
