// Pure text-layer geometry. No DOM; importable in Node.
// Spaces:
//  - source uv: 0..1, top-origin, unrotated image (same space as params.crop).
//  - output t: 0..1, top-origin, the rendered frame (after crop, 90° steps and straighten).
//  - clip: -1..1, y up (WebGL).
// Matrices are row-major 3x3 arrays [a,b,c, d,e,f, g,h,i]:
//   (x,y,1) -> ((a x + b y + c) / w, (d x + e y + f) / w), w = g x + h y + i.
// A text layer is drawn as a sprite on a quad: 4 source-uv corners TL, TR, BR, BL.

export const I3 = () => [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function mul(A, B) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    r[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
  }
  return r;
}

export function inv(M) {
  const [a, b, c, d, e, f, g, h, i] = M;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!det || !Number.isFinite(det)) return null;
  const k = 1 / det;
  return [
    A * k, -(b * i - c * h) * k, (b * f - c * e) * k,
    B * k, (a * i - c * g) * k, -(a * f - c * d) * k,
    C * k, -(a * h - b * g) * k, (a * e - b * d) * k,
  ];
}

export function apply(M, x, y) {
  const w = M[6] * x + M[7] * y + M[8];
  return [(M[0] * x + M[1] * y + M[2]) / w, (M[3] * x + M[4] * y + M[5]) / w];
}

// Homography taking the unit square (0,0)(1,0)(1,1)(0,1) onto quad q = [TL, TR, BR, BL] (Heckbert).
export function squareToQuad(q) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = den ? (dx3 * dy2 - dx2 * dy3) / den : 0;
  const h = den ? (dx1 * dy3 - dx3 * dy1) / den : 0;
  return [
    x1 - x0 + g * x1, x3 - x0 + h * x3, x0,
    y1 - y0 + g * y1, y3 - y0 + h * y3, y0,
    g, h, 1,
  ];
}

// Output t -> source uv, exactly the preview shader (straighten, then rotUV, then crop).
export function outToSrc(p, outW, outH) {
  const A = outW / Math.max(1, outH);
  const crop = (p && p.crop) || { x: 0, y: 0, w: 1, h: 1 };
  const steps = ((Math.round(((p && p.rotation) || 0) / 90) % 4) + 4) % 4;
  const rad = (((p && p.straighten) || 0) * Math.PI) / 180;
  let S = I3();
  if (Math.abs(rad) > 1e-5) {
    const cs = Math.cos(rad), sn = Math.sin(rad);
    const zoom = cs + Math.abs(sn) * Math.max(A, 1 / A);
    const l00 = cs / zoom, l01 = -sn / A / zoom, l10 = (sn * A) / zoom, l11 = cs / zoom;
    S = [l00, l01, 0.5 - 0.5 * (l00 + l01), l10, l11, 0.5 - 0.5 * (l10 + l11), 0, 0, 1];
  }
  const R = [I3(), [0, -1, 1, 1, 0, 0, 0, 0, 1], [-1, 0, 1, 0, -1, 1, 0, 0, 1], [0, 1, 0, -1, 0, 1, 0, 0, 1]][steps];
  const C = [crop.w, 0, crop.x, 0, crop.h, crop.y, 0, 0, 1];
  return mul(C, mul(R, S));
}

// Everything the overlay and the gizmo need to go between source uv and the frame.
export function frameMap(p, outW, outH) {
  const toSrc = outToSrc(p, outW, outH);
  return { toSrc, toOut: inv(toSrc) || I3(), outW, outH };
}

export const OUT_TO_CLIP = [2, 0, -1, 0, -2, 1, 0, 0, 1];

// Rotation (degrees, clockwise on screen) that source pixels get on their way to the frame.
export function displayAngle(toOut, outW, outH, imgW, imgH) {
  const a = toOut[0] * outW / imgW, d = toOut[3] * outH / imgW;
  return (Math.atan2(d, a) * 180) / Math.PI;
}

// Output pixels per source pixel (the map is a similarity in pixel units).
export function displayScale(toOut, outW, outH, imgW) {
  return Math.hypot(toOut[0] * outW / imgW, toOut[3] * outH / imgW);
}

const rotXY = (x, y, rad) => [x * Math.cos(rad) - y * Math.sin(rad), x * Math.sin(rad) + y * Math.cos(rad)];

// Quad for a '2d' or 'tilt' placement. m = sprite box {w,h} in font-size units;
// place.size = font size as a fraction of image height; rot/rx/ry in degrees.
export function placeQuad(place, m, imgW, imgH) {
  const F = (place.size || 0.1) * imgH;
  const hw = (m.w * F) / 2, hh = (m.h * F) / 2;
  let pts = [[-hw, -hh, 0], [hw, -hh, 0], [hw, hh, 0], [-hw, hh, 0]];
  if (place.mode === 'tilt') {
    const rx = ((place.rx || 0) * Math.PI) / 180, ry = ((place.ry || 0) * Math.PI) / 180;
    const edge = Math.max(hw, hh) * 2;
    const k = Math.min(1, Math.max(0, (place.persp ?? 60) / 100));
    const f = edge * (3.2 - 2.6 * k); // focal length: 0 = nearly flat, 100 = strong wide-angle look
    pts = pts.map(([x, y]) => {
      const y1 = y * Math.cos(rx), z1 = y * Math.sin(rx);
      const x2 = x * Math.cos(ry) + z1 * Math.sin(ry), z2 = -x * Math.sin(ry) + z1 * Math.cos(ry);
      const s = f / Math.max(f * 0.05, f + z2);
      return [x2 * s, y1 * s, 0];
    });
  }
  const rad = ((place.rot || 0) * Math.PI) / 180;
  const cx = (place.cx ?? 0.5) * imgW, cy = (place.cy ?? 0.5) * imgH;
  return pts.map(([x, y]) => {
    const [rx2, ry2] = rotXY(x, y, rad);
    return [(cx + rx2) / imgW, (cy + ry2) / imgH];
  });
}

// Pixel-space convexity with a consistent winding (a self-crossing pin would render garbage).
export function isConvexQuad(q, imgW = 1, imgH = 1) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 4], [cx, cy] = q[(i + 2) % 4];
    const cr = (bx - ax) * imgW * (cy - by) * imgH - (by - ay) * imgH * (cx - bx) * imgW;
    if (Math.abs(cr) < 1e-12) return false;
    const s = Math.sign(cr);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

export function pointInQuad(q, x, y) {
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const [xi, yi] = q[i], [xj, yj] = q[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function quadCenter(q) {
  const H = squareToQuad(q);
  return apply(H, 0.5, 0.5);
}

// Full sprite-uv -> clip transform; flipped if needed so w > 0 across the quad.
export function spriteToClip(quad, toOut) {
  let M = mul(OUT_TO_CLIP, mul(toOut, squareToQuad(quad)));
  if (M[6] * 0.5 + M[7] * 0.5 + M[8] < 0) M = M.map((v) => -v);
  return M;
}
