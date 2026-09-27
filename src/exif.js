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

export function copyExif(originalBytes, newJpegBytes) {
  const app1 = extractApp1(originalBytes);
  if (!app1) return newJpegBytes;
  return insertApp1(newJpegBytes, setOrientation1(app1));
}
