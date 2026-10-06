// Pure crop/geometry math. No DOM; importable in Node.
// Spaces:
//  - source space: normalized 0..1 rect in the unrotated, top-origin image (params.crop).
//  - display space: normalized 0..1 rect in the view after params.rotation (cw 90° steps).
// Point mapping display -> source is exactly the shader's rotUV():
//   steps 1: (1-y, x)   steps 2: (1-x, 1-y)   steps 3: (y, 1-x)
// The inverse of step k is step (4-k)%4.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function clamp01Rect(r, min = 0.05) {
  const w = clamp(Number.isFinite(r.w) ? r.w : 1, min, 1);
  const h = clamp(Number.isFinite(r.h) ? r.h : 1, min, 1);
  const x = clamp(Number.isFinite(r.x) ? r.x : 0, 0, 1 - w);
  const y = clamp(Number.isFinite(r.y) ? r.y : 0, 0, 1 - h);
  return { x, y, w, h };
}

export function rotSteps(rotation) {
  return ((Math.round((rotation || 0) / 90) % 4) + 4) % 4;
}

function rotPoint(x, y, steps) {
  switch (steps) {
    case 1: return [1 - y, x];
    case 2: return [1 - x, 1 - y];
    case 3: return [y, 1 - x];
    default: return [x, y];
  }
}

function mapRect(r, steps) {
  const [ax, ay] = rotPoint(r.x, r.y, steps);
  const [bx, by] = rotPoint(r.x + r.w, r.y + r.h, steps);
  const x = Math.min(ax, bx), y = Math.min(ay, by);
  return { x, y, w: Math.max(ax, bx) - x, h: Math.max(ay, by) - y };
}

export function displayToSource(rect, steps) {
  return mapRect(rect, ((steps % 4) + 4) % 4);
}

export function sourceToDisplay(rect, steps) {
  return mapRect(rect, (4 - (((steps % 4) + 4) % 4)) % 4);
}

export function displayAspect(imgW, imgH, steps) {
  const w = imgW > 0 ? imgW : 1, h = imgH > 0 ? imgH : 1;
  return steps % 2 ? h / w : w / h;
}

// Largest centered display rect whose pixel ratio == ratio (normalized w/h = ratio/dispAspect).
export function centeredAspectRect(ratio, dispAspect) {
  const k = ratio / (dispAspect > 0 ? dispAspect : 1);
  let w = 1, h = 1;
  if (k <= 1) w = k; else h = 1 / k;
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

export function moveRect(start, dx, dy) {
  const w = clamp(start.w, 0, 1), h = clamp(start.h, 0, 1);
  return { x: clamp(start.x + dx, 0, 1 - w), y: clamp(start.y + dy, 0, 1 - h), w, h };
}

// corner: 'tl'|'tr'|'bl'|'br'. Opposite corner is the anchor.
export function resizeFromCorner(start, corner, dx, dy, lockRatio, dispAspect, min = 0.05) {
  const left = corner.includes('l'), top = corner.includes('t');
  const ax = left ? start.x + start.w : start.x;
  const ay = top ? start.y + start.h : start.y;
  const sx = left ? -1 : 1, sy = top ? -1 : 1;
  // Size measured away from the anchor (negative = crossed the anchor).
  let w = start.w + sx * dx;
  let h = start.h + sy * dy;
  const maxW = left ? ax : 1 - ax;
  const maxH = top ? ay : 1 - ay;
  if (lockRatio > 0) {
    const k = lockRatio / (dispAspect > 0 ? dispAspect : 1); // normalized w/h
    // Dominant axis: compare relative pointer travel.
    if (Math.abs(dx) >= Math.abs(dy) * k) h = w / k; else w = h * k;
    const lo = Math.max(min, min * k);
    const hi = Math.min(maxW, maxH * k);
    w = clamp(w, Math.min(lo, hi), hi);
    h = w / k;
  } else {
    w = clamp(w, Math.min(min, maxW), maxW);
    h = clamp(h, Math.min(min, maxH), maxH);
  }
  return { x: left ? ax - w : ax, y: top ? ay - h : ay, w, h };
}

// edge: 't'|'r'|'b'|'l'. Opposite side is the anchor. Free: only that axis changes.
// Locked: the dragged side moves and the other axis grows/shrinks around the box centre.
export function resizeFromEdge(start, edge, dx, dy, lockRatio, dispAspect, min = 0.05) {
  const horiz = edge === 't' || edge === 'b'; // a horizontal side: height changes
  const neg = edge === 't' || edge === 'l';   // dragged side is the near (top/left) one
  const k = lockRatio > 0 ? lockRatio / (dispAspect > 0 ? dispAspect : 1) : 0; // normalized w/h
  const pos = horiz ? start.y : start.x, size = horiz ? start.h : start.w;
  const anchor = neg ? pos + size : pos;
  const delta = horiz ? dy : dx;
  let n = size + (neg ? -delta : delta);
  let hi = neg ? anchor : 1 - anchor;
  let lo = min;
  if (k > 0) {
    const cross = horiz ? start.x + start.w / 2 : start.y + start.h / 2;
    const crossMax = 2 * Math.min(cross, 1 - cross); // widest symmetric span inside the image
    hi = Math.min(hi, horiz ? crossMax / k : crossMax * k);
    lo = horiz ? Math.max(min, min / k) : Math.max(min, min * k);
  }
  n = clamp(n, Math.min(lo, hi), hi);
  const p0 = neg ? anchor - n : anchor;
  if (k > 0) {
    const cross = horiz ? start.x + start.w / 2 : start.y + start.h / 2;
    const m = horiz ? n * k : n / k;
    return horiz ? { x: cross - m / 2, y: p0, w: m, h: n } : { x: p0, y: cross - m / 2, w: n, h: m };
  }
  return horiz ? { x: start.x, y: p0, w: start.w, h: n } : { x: p0, y: start.y, w: n, h: start.h };
}

// Pixel size of the rotated crop, longest edge capped at maxEdge (never upscaled).
export function outputSize(imgW, imgH, crop, steps, maxEdge) {
  let cw = Math.max(1, Math.round(imgW * crop.w));
  let ch = Math.max(1, Math.round(imgH * crop.h));
  if (steps % 2) [cw, ch] = [ch, cw];
  const s = Math.min(1, (maxEdge > 0 ? maxEdge : Infinity) / Math.max(cw, ch));
  return { w: Math.max(1, Math.round(cw * s)), h: Math.max(1, Math.round(ch * s)) };
}

// Thumbnail size: preserves aspect, longest edge = longEdge (no upscale), each >= 1.
export function thumbSize(w, h, longEdge = 320) {
  const W = w > 0 ? w : 1, H = h > 0 ? h : 1;
  const s = Math.min(1, longEdge / Math.max(W, H));
  return { w: Math.max(1, Math.round(W * s)), h: Math.max(1, Math.round(H * s)) };
}

// Justified gallery rows: every full row exactly fills `width`, keeping each item's aspect.
// aspects: w/h per item. Returns [{ start, end, height }] (end exclusive).
// The last, partial row keeps `targetH` (or folds into the row above when under half full).
export function justifyRows(aspects, width, targetH, gap = 2) {
  const rows = [];
  let start = 0, sum = 0;
  for (let i = 0; i < aspects.length; i++) {
    sum += aspects[i] > 0 ? aspects[i] : 1;
    const n = i - start + 1;
    const h = (width - gap * (n - 1)) / sum;
    if (h <= targetH) {
      rows.push({ start, end: i + 1, height: h });
      start = i + 1; sum = 0;
    }
  }
  if (start < aspects.length) {
    const n = aspects.length - start;
    const natural = sum * targetH + gap * (n - 1);
    const prev = rows[rows.length - 1];
    if (prev && natural < width * 0.5) {
      // Mostly-empty last row: fold it into the previous row so nothing is left orphaned.
      const all = aspects.slice(prev.start).reduce((a, b) => a + (b > 0 ? b : 1), 0);
      prev.end = aspects.length;
      prev.height = (width - gap * (prev.end - prev.start - 1)) / all;
    } else {
      rows.push({ start, end: aspects.length, height: targetH });
    }
  }
  return rows;
}
