// exif.js — carry EXIF metadata across a re-encode.
//
// When Nomi overwrites a user's JPEG with an edited version, the new bytes come
// from canvas.toBlob('image/jpeg'), which writes no metadata at all. Without this
// module the photo would lose its date taken, GPS position, camera model, etc.
// We lift the original's Exif APP1 segment verbatim and splice it into the new
// file. The edited pixels were decoded with imageOrientation:'from-image', so
// they are already upright: the Orientation tag must be reset to 1 or viewers
// would rotate the image a second time.
//
// Pure functions over Uint8Array; no DOM, works in Node. Never throws on bad input.

const EXIF_ID = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"

function isJpeg(b) {
  return b instanceof Uint8Array && b.length >= 4 && b[0] === 0xFF && b[1] === 0xD8;
}

// Walk marker segments after SOI. Returns { segs: [{marker,start,end}], rest }
// where `rest` is the offset of the first byte not covered by a segment (the SOS
// marker, EOI, or wherever parsing had to stop). Returns null if not a JPEG.
function walk(b) {
  if (!isJpeg(b)) return null;
  const segs = [];
  let i = 2;
  const n = b.length;
  while (i + 1 < n) {
    if (b[i] !== 0xFF) break; // not at a marker: malformed, stop
    // FF fill bytes: any run of FF before the real marker byte.
    while (i + 1 < n && b[i + 1] === 0xFF) i++;
    if (i + 1 >= n) break;
    const m = b[i + 1];
    if (m === 0xDA || m === 0xD9 || m === 0xD8) break; // SOS / EOI / stray SOI
    if (m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { // standalone markers, no length
      segs.push({ marker: m, start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (i + 3 >= n) break;
    const len = (b[i + 2] << 8) | b[i + 3]; // length includes its own 2 bytes, not the marker
    if (len < 2 || i + 2 + len > n) break; // truncated
    segs.push({ marker: m, start: i, end: i + 2 + len });
    i += 2 + len;
  }
  return { segs, rest: Math.min(i, n) };
}

function isExifSeg(b, s) {
  if (s.marker !== 0xE1 || s.end - s.start < 4 + EXIF_ID.length) return false;
  // payload starts after FF E1 LL LL
  for (let k = 0; k < EXIF_ID.length; k++) if (b[s.start + 4 + k] !== EXIF_ID[k]) return false;
  return true;
}

export function extractApp1(jpegBytes) {
  try {
    const w = walk(jpegBytes);
    if (!w) return null;
    const s = w.segs.find((seg) => isExifSeg(jpegBytes, seg));
    return s ? jpegBytes.slice(s.start, s.end) : null;
  } catch {
    return null;
  }
}

export function setOrientation1(app1) {
  if (!(app1 instanceof Uint8Array)) return app1;
  const out = app1.slice();
  try {
    const n = out.length;
    // FF E1 (2) + length (2) + "Exif\0\0" (6) => TIFF header starts at 10.
    const T = 10;
    if (n < T + 8) return out;
    for (let k = 0; k < EXIF_ID.length; k++) if (out[4 + k] !== EXIF_ID[k]) return out;
    let le;
    if (out[T] === 0x49 && out[T + 1] === 0x49) le = true;       // "II"
    else if (out[T] === 0x4D && out[T + 1] === 0x4D) le = false; // "MM"
    else return out;
    const u16 = (o) => (le ? out[o] | (out[o + 1] << 8) : (out[o] << 8) | out[o + 1]);
    const u32 = (o) => (le
      ? (out[o] | (out[o + 1] << 8) | (out[o + 2] << 16) | (out[o + 3] << 24)) >>> 0
      : ((out[o] << 24) | (out[o + 1] << 16) | (out[o + 2] << 8) | out[o + 3]) >>> 0);
    if (u16(T + 2) !== 42) return out;
    // IFD0 offset (bytes 4..7 of the TIFF header) is relative to the TIFF start.
    const ifd = T + u32(T + 4);
    if (ifd + 2 > n) return out;
    const count = u16(ifd);
    for (let e = 0; e < count; e++) {
      const p = ifd + 2 + e * 12; // entry: tag(2) type(2) count(4) value/offset(4)
      if (p + 12 > n) break;
      if (u16(p) !== 0x0112) continue;
      if (u16(p + 2) === 3 && u32(p + 4) === 1) {
        // A single SHORT sits left-justified in the 4-byte value field.
        if (le) { out[p + 8] = 1; out[p + 9] = 0; } else { out[p + 8] = 0; out[p + 9] = 1; }
      }
      break;
    }
    return out;
  } catch {
    return app1.slice();
  }
}

export function insertApp1(jpegBytes, app1) {
  if (!app1 || !(app1 instanceof Uint8Array)) return jpegBytes;
  let w;
  try { w = walk(jpegBytes); } catch { return jpegBytes; }
  if (!w) return jpegBytes;
  const b = jpegBytes;
  const parts = [b.subarray(0, 2)]; // SOI
  let k = 0;
  // JFIF (and JFXX) APP0 must stay first, so keep leading APP0s ahead of Exif.
  while (k < w.segs.length && w.segs[k].marker === 0xE0) {
    parts.push(b.subarray(w.segs[k].start, w.segs[k].end));
    k++;
  }
  parts.push(app1);
  for (; k < w.segs.length; k++) {
    const s = w.segs[k];
    if (isExifSeg(b, s)) continue; // drop any existing Exif so there is only one
    parts.push(b.subarray(s.start, s.end));
  }
  parts.push(b.subarray(w.rest)); // SOS, entropy data, EOI verbatim
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// Size of a JPEG from its first SOFn marker, or null.
export function jpegSize(b) {
  try {
    if (!isJpeg(b)) return null;
    let i = 2;
    while (i + 8 < b.length) {
      if (b[i] !== 0xFF) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xFF) { i++; continue; }
      if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
      if (m === 0xD9) return null;
      const len = (b[i + 2] << 8) | b[i + 3];
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
        return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
      }
      i += 2 + len;
    }
  } catch { /* fall through */ }
  return null;
}

// The original's Exif describes the ORIGINAL picture, so after an edit parts of it lie:
//  - IFD1 holds a small embedded preview of the original. Finder, Quick Look, Preview and Photos
//    show it as the icon / thumbnail, so an exposure, filter or text edit looks like it was never saved.
//    Drop it (viewers regenerate a thumbnail from the real pixels).
//  - PixelXDimension / PixelYDimension (Exif IFD) still say the old size after a crop or rotate.
// Everything else (date, GPS, camera, lens) is kept verbatim. Never throws; unknown layouts return unchanged.
export function refreshForEdit(app1, size) {
  if (!(app1 instanceof Uint8Array)) return app1;
  let out = app1.slice();
  try {
    const n = out.length, T = 10;
    if (n < T + 8) return out;
    for (let k = 0; k < EXIF_ID.length; k++) if (out[4 + k] !== EXIF_ID[k]) return out;
    const le = out[T] === 0x49 && out[T + 1] === 0x49;
    if (!le && !(out[T] === 0x4D && out[T + 1] === 0x4D)) return out;
    const u16 = (o) => (le ? out[o] | (out[o + 1] << 8) : (out[o] << 8) | out[o + 1]);
    const u32 = (o) => (le
      ? (out[o] | (out[o + 1] << 8) | (out[o + 2] << 16) | (out[o + 3] << 24)) >>> 0
      : ((out[o] << 24) | (out[o + 1] << 16) | (out[o + 2] << 8) | out[o + 3]) >>> 0);
    const put16 = (o, v) => { if (le) { out[o] = v & 255; out[o + 1] = v >> 8; } else { out[o] = v >> 8; out[o + 1] = v & 255; } };
    const put32 = (o, v) => { for (let k = 0; k < 4; k++) out[o + (le ? k : 3 - k)] = (v >>> (8 * k)) & 255; };
    if (u16(T + 2) !== 42) return out;
    const entries = (ifd) => {
      if (ifd < T || ifd + 2 > n) return [];
      const c = u16(ifd), list = [];
      for (let e = 0; e < c && ifd + 2 + e * 12 + 12 <= n; e++) list.push(ifd + 2 + e * 12);
      return list;
    };
    const ifd0 = T + u32(T + 4);
    const ifd0Entries = entries(ifd0);

    // New pixel size in the Exif sub-IFD.
    if (size && size.width && size.height) {
      const ptr = ifd0Entries.find((p) => u16(p) === 0x8769);
      if (ptr) {
        for (const p of entries(T + u32(ptr + 8))) {
          const tag = u16(p), v = tag === 0xA002 ? size.width : tag === 0xA003 ? size.height : null;
          if (v == null) continue;
          if (u16(p + 2) === 4) put32(p + 8, v);
          else if (u16(p + 2) === 3 && v < 65536) put16(p + 8, v);
        }
      }
    }

    // Drop the embedded thumbnail: cut the IFD0 -> IFD1 link, then remove or blank its bytes.
    const linkAt = ifd0 + 2 + ifd0Entries.length * 12;
    if (linkAt + 4 <= n) {
      const ifd1 = u32(linkAt);
      if (ifd1) {
        put32(linkAt, 0);
        let off = 0, len = 0;
        for (const p of entries(T + ifd1)) {
          if (u16(p) === 0x0201) off = u32(p + 8);
          if (u16(p) === 0x0202) len = u32(p + 8);
        }
        const from = T + off, to = from + len;
        if (off && len && to <= n) {
          if (to === n) { // tail-aligned (the usual layout): cut it off and fix the segment length
            out = out.slice(0, from);
            out[2] = (out.length - 2) >> 8; out[3] = (out.length - 2) & 255;
          } else out.fill(0, from, to);
        }
      }
    }
    return out;
  } catch {
    return app1.slice();
  }
}

export function copyExif(originalBytes, newJpegBytes) {
  const app1 = extractApp1(originalBytes);
  if (!app1) return newJpegBytes;
  return insertApp1(newJpegBytes, refreshForEdit(setOrientation1(app1), jpegSize(newJpegBytes)));
}
