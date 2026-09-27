// Text layer -> Canvas2D sprite (fonts, fill, outline, shadow, shape, faux-3D extrude).
// All layout happens at a 100px reference font size ("units" below are 1/100 of the font size);
// sprites are rendered at whatever pixel scale the placement needs and cached.

export const FONTS = [
  { id: 'bodoni', family: 'Bodoni Moda', label: 'Bodoni', q: 'Bodoni+Moda:ital,wght@0,400;0,700;1,400;1,700' },
  { id: 'playfair', family: 'Playfair Display', label: 'Playfair', q: 'Playfair+Display:ital,wght@0,400;0,700;1,400;1,700' },
  { id: 'abril', family: 'Abril Fatface', label: 'Abril', q: 'Abril+Fatface' },
  { id: 'cinzel', family: 'Cinzel', label: 'Cinzel', q: 'Cinzel:wght@400;700' },
  { id: 'limelight', family: 'Limelight', label: 'Limelight', q: 'Limelight' },
  { id: 'bebas', family: 'Bebas Neue', label: 'Bebas', q: 'Bebas+Neue' },
  { id: 'anton', family: 'Anton', label: 'Anton', q: 'Anton' },
  { id: 'archivo', family: 'Archivo Black', label: 'Archivo', q: 'Archivo+Black' },
  { id: 'grotesk', family: 'Space Grotesk', label: 'Grotesk', q: 'Space+Grotesk:wght@400;700' },
  { id: 'pacifico', family: 'Pacifico', label: 'Pacifico', q: 'Pacifico' },
  { id: 'lobster', family: 'Lobster', label: 'Lobster', q: 'Lobster' },
  { id: 'vibes', family: 'Great Vibes', label: 'Vibes', q: 'Great+Vibes' },
  { id: 'marker', family: 'Permanent Marker', label: 'Marker', q: 'Permanent+Marker' },
  { id: 'monoton', family: 'Monoton', label: 'Monoton', q: 'Monoton' },
  { id: 'bungee', family: 'Bungee Shade', label: 'Bungee', q: 'Bungee+Shade' },
  { id: 'mono', family: 'JetBrains Mono', label: 'Mono', q: 'JetBrains+Mono:ital,wght@0,400;0,700;1,400' },
];
const fontOf = (id) => FONTS.find((f) => f.id === id) || FONTS[0];

export const SHAPES = ['none', 'box', 'pill', 'circle', 'banner', 'underline', 'burst'];

export function newLayer(over = {}) {
  return {
    id: 'tx_' + Math.random().toString(36).slice(2, 9),
    text: 'your text',
    font: 'bodoni', bold: false, italic: false, caps: false, align: 'center',
    tracking: 0, lineHeight: 110, stretch: 100,
    fill: { color: '#ffffff', color2: '#f19e4b', gradient: false },
    stroke: { width: 0, color: '#000000' },
    shadow: { blur: 0, dist: 0, angle: 45, color: '#000000', opacity: 60 },
    shape: { kind: 'none', color: '#111111', pad: 30 },
    extrude: { depth: 0, angle: 45, color: '#333333' },
    place: { mode: '2d', cx: 0.5, cy: 0.5, size: 0.1, rot: 0, rx: 0, ry: -35, persp: 60, quad: null },
    blend: { mode: 'normal', opacity: 100, texture: 0, light: 0 },
    ...over,
  };
}

// Style patches. Placement is never touched, so a preset restyles text where it already sits.
export const PRESETS = [
  { id: 'wall', label: 'wall paint', patch: {
    font: 'bodoni', bold: false, italic: false, caps: true, tracking: 4, stretch: 72, lineHeight: 105,
    fill: { color: '#f6f3ec', gradient: false }, stroke: { width: 0 }, shadow: { blur: 0, dist: 0 },
    shape: { kind: 'none' }, extrude: { depth: 0 }, blend: { mode: 'normal', opacity: 94, texture: 55, light: 45 } } },
  { id: 'neon', label: 'neon', patch: {
    font: 'pacifico', bold: false, italic: false, caps: false, tracking: 0, stretch: 100,
    fill: { color: '#fff4fd', gradient: false }, stroke: { width: 0 }, shadow: { blur: 40, dist: 0, color: '#ff2bd6', opacity: 100 },
    shape: { kind: 'none' }, extrude: { depth: 0 }, blend: { mode: 'screen', opacity: 100, texture: 0, light: 0 } } },
  { id: 'retro', label: 'retro 3d', patch: {
    font: 'abril', bold: false, italic: false, caps: false, tracking: 0, stretch: 100,
    fill: { color: '#ffd23f', gradient: false }, stroke: { width: 4, color: '#1b1b1b' }, shadow: { blur: 0, dist: 0 },
    shape: { kind: 'none' }, extrude: { depth: 16, angle: 45, color: '#e4572e' }, blend: { mode: 'normal', opacity: 100, texture: 0, light: 0 } } },
  { id: 'gold', label: 'gold', patch: {
    font: 'cinzel', bold: true, italic: false, caps: true, tracking: 6, stretch: 100,
    fill: { color: '#fff1b8', color2: '#a8741a', gradient: true }, stroke: { width: 2, color: '#5a3d0a' },
    shadow: { blur: 14, dist: 6, angle: 60, color: '#000000', opacity: 55 },
    shape: { kind: 'none' }, extrude: { depth: 6, angle: 90, color: '#6b4a12' }, blend: { mode: 'normal', opacity: 100, texture: 0, light: 20 } } },
  { id: 'sticker', label: 'sticker', patch: {
    font: 'marker', bold: false, italic: false, caps: false, tracking: 0, stretch: 100,
    fill: { color: '#141414', gradient: false }, stroke: { width: 0 }, shadow: { blur: 16, dist: 6, angle: 70, color: '#000000', opacity: 45 },
    shape: { kind: 'pill', color: '#ffffff', pad: 26 }, extrude: { depth: 0 }, blend: { mode: 'normal', opacity: 100, texture: 0, light: 0 } } },
  { id: 'label', label: 'label', patch: {
    font: 'bebas', bold: false, italic: false, caps: true, tracking: 8, stretch: 100,
    fill: { color: '#ffffff', gradient: false }, stroke: { width: 0 }, shadow: { blur: 0, dist: 0 },
    shape: { kind: 'box', color: '#111111', pad: 22 }, extrude: { depth: 0 }, blend: { mode: 'normal', opacity: 100, texture: 0, light: 0 } } },
  { id: 'poster', label: 'poster', patch: {
    font: 'anton', bold: false, italic: false, caps: true, tracking: 1, stretch: 100,
    fill: { color: '#ff4d4d', gradient: false }, stroke: { width: 0 }, shadow: { blur: 0, dist: 0 },
    shape: { kind: 'none' }, extrude: { depth: 45, angle: 45, color: '#1a1a1a' }, blend: { mode: 'normal', opacity: 100, texture: 0, light: 0 } } },
];

export function applyPreset(layer, id) {
  const pr = PRESETS.find((x) => x.id === id);
  if (!pr) return;
  for (const [k, v] of Object.entries(pr.patch)) {
    if (v && typeof v === 'object') layer[k] = { ...layer[k], ...v };
    else layer[k] = v;
  }
}

// ---------- fonts ----------
let cssPromise = null;
function ensureCSS() {
  if (cssPromise) return cssPromise;
  if (typeof document === 'undefined') return (cssPromise = Promise.resolve());
  const href = 'https://fonts.googleapis.com/css2?' + FONTS.map((f) => 'family=' + f.q).join('&') + '&display=block';
  cssPromise = new Promise((res) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = link.onerror = () => res();
    document.head.appendChild(link);
  });
  return cssPromise;
}

export function fontString(layer, px) {
  const f = fontOf(layer.font);
  return `${layer.italic ? 'italic ' : ''}${layer.bold ? 700 : 400} ${px}px "${f.family}", serif`;
}

const loaded = new Set(), pending = new Map();
let onFontsChanged = null;
export function setFontListener(fn) { onFontsChanged = fn; }
const fontKey = (l) => `${l.font}|${l.bold ? 1 : 0}|${l.italic ? 1 : 0}`;

export function loadFont(layer) {
  const k = fontKey(layer);
  if (loaded.has(k)) return Promise.resolve();
  if (pending.has(k)) return pending.get(k);
  const pr = ensureCSS()
    .then(() => document.fonts.load(fontString(layer, 100), layer.text || 'A'))
    .catch(() => {})
    .then(() => { loaded.add(k); pending.delete(k); measureCache.clear(); if (onFontsChanged) onFontsChanged(); });
  pending.set(k, pr);
  return pr;
}

export function ensureFonts(layers) {
  return Promise.all((layers || []).map(loadFont));
}

// Warm the font list so chips can preview themselves.
export function preloadFontCSS() { return ensureCSS(); }

// ---------- layout ----------
let mctx = null;
const measureCtx = () => mctx || (mctx = document.createElement('canvas').getContext('2d'));
const measureCache = new Map();
const lines = (l) => String(l.caps ? (l.text || '').toUpperCase() : l.text || '').split('\n');
const hasLetterSpacing = () => typeof CanvasRenderingContext2D !== 'undefined' && 'letterSpacing' in CanvasRenderingContext2D.prototype;

function setFont(ctx, l) {
  ctx.font = fontString(l, 100);
  if (hasLetterSpacing()) ctx.letterSpacing = `${l.tracking || 0}px`;
}

// Text box and full sprite extents in units (100 = font size).
function layout(l) {
  const key = JSON.stringify([l.text, l.font, l.bold, l.italic, l.caps, l.tracking, l.lineHeight, l.stretch, l.stroke.width,
    l.shadow, l.shape.kind, l.shape.pad, l.extrude.depth, l.extrude.angle]);
  const hit = measureCache.get(key);
  if (hit) return hit;
  const ctx = measureCtx();
  setFont(ctx, l);
  const ls = lines(l);
  const widths = ls.map((s) => ctx.measureText(s).width);
  const cap = ctx.measureText('H').actualBoundingBoxAscent || 72;
  const descRef = ctx.measureText('gjpqy').actualBoundingBoxDescent || 22;
  const desc = /[gjpqyQ,;_()[\]{}|@$ʒ]/.test(ls.join('')) ? descRef : 2;
  const lh = l.lineHeight || 110;
  const st = (l.stretch || 100) / 100;
  const boxW = Math.max(20, ...widths) * st;
  const boxH = cap + desc + (ls.length - 1) * lh;
  const sw = l.stroke.width || 0;
  const tx = boxW / 2 + sw + (l.italic ? 18 : 10), ty = boxH / 2 + sw + 10;
  const sh = shapeExtent(l.shape.kind, boxW, boxH, l.shape.pad || 0);
  const ext = l.extrude.depth || 0;
  const shadow = (l.shadow.blur || 0) * 1.2 + (l.shadow.dist || 0);
  const fx = Math.max(ext, shadow) + 4;
  const r = {
    lines: ls, widths, cap, lh, boxW, boxH, st,
    w: (Math.max(tx, sh[0]) + fx) * 2 / 100, // in font-size units, for placement
    h: (Math.max(ty, sh[1]) + fx) * 2 / 100,
  };
  measureCache.set(key, r);
  if (measureCache.size > 200) measureCache.delete(measureCache.keys().next().value);
  return r;
}

// Sprite box {w, h} in font-size units (what placeQuad needs).
export function measure(l) {
  const r = layout(l);
  return { w: r.w, h: r.h };
}

function shapeExtent(kind, bw, bh, pad) {
  const X = bw / 2 + pad, Y = bh / 2 + pad;
  switch (kind) {
    case 'box': case 'pill': return [X, Y];
    case 'circle': return [bw / 2 * 1.42 + pad, bh / 2 * 1.42 + pad];
    case 'burst': return [bw / 2 * 1.45 + pad, bh / 2 * 1.45 + pad + 10];
    case 'banner': return [X + Y * 0.8, Y];
    case 'underline': return [X, bh / 2 + 8 + 9 + pad * 0.3];
    default: return [0, 0];
  }
}

function shapePath(ctx, kind, bw, bh, pad) {
  const X = bw / 2 + pad, Y = bh / 2 + pad;
  ctx.beginPath();
  if (kind === 'box') ctx.rect(-X, -Y, 2 * X, 2 * Y);
  else if (kind === 'pill') {
    const r = Math.min(Y, X);
    ctx.moveTo(-X + r, -Y); ctx.lineTo(X - r, -Y); ctx.arc(X - r, 0, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(-X + r, Y); ctx.arc(-X + r, 0, r, Math.PI / 2, Math.PI * 1.5);
  } else if (kind === 'circle') ctx.ellipse(0, 0, bw / 2 * 1.42 + pad, bh / 2 * 1.42 + pad, 0, 0, Math.PI * 2);
  else if (kind === 'burst') {
    const rx = bw / 2 * 1.45 + pad, ry = bh / 2 * 1.45 + pad + 10, n = 18;
    for (let i = 0; i < n * 2; i++) {
      const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2, k = i % 2 ? 0.86 : 1;
      i ? ctx.lineTo(Math.cos(a) * rx * k, Math.sin(a) * ry * k) : ctx.moveTo(Math.cos(a) * rx, Math.sin(a) * ry);
    }
  } else if (kind === 'banner') {
    const n = Y * 0.8;
    ctx.moveTo(-X - n, -Y); ctx.lineTo(X + n, -Y); ctx.lineTo(X, 0); ctx.lineTo(X + n, Y);
    ctx.lineTo(-X - n, Y); ctx.lineTo(-X, 0);
  } else if (kind === 'underline') ctx.rect(-X, bh / 2 + 8 + pad * 0.3, 2 * X, 9);
  ctx.closePath();
}

function rgba(hex, a = 1) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function shade(hex, k) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0;
  const f = (v) => Math.round(v * (1 - k));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// ---------- rendering ----------
const spriteCache = new Map(); // key -> {canvas, w, h}
let cachedPixels = 0;
const MAX_CACHE_PX = 48e6;

// Sprite whose pixel height is about targetH (bucketed to quarter octaves so drags don't re-render).
export function getSprite(l, targetH, maxEdge = 4096) {
  const lay = layout(l);
  const Wu = lay.w * 100, Hu = lay.h * 100;
  let k = Math.max(8, targetH) / Hu;
  k = Math.pow(2, Math.ceil(Math.log2(k) * 4) / 4);
  k = Math.min(k, maxEdge / Wu, maxEdge / Hu);
  const fontReady = loaded.has(fontKey(l));
  if (!fontReady) loadFont(l);
  const key = JSON.stringify([l.text, l.font, l.bold, l.italic, l.caps, l.align, l.tracking, l.lineHeight, l.stretch,
    l.fill, l.stroke, l.shadow, l.shape, l.extrude, k.toFixed(4), fontReady]);
  const hit = spriteCache.get(key);
  if (hit) { spriteCache.delete(key); spriteCache.set(key, hit); return hit; }
  const cw = Math.max(1, Math.round(Wu * k)), ch = Math.max(1, Math.round(Hu * k));
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  draw(canvas, l, lay, k);
  const s = { canvas, w: cw, h: ch, key };
  spriteCache.set(key, s);
  cachedPixels += cw * ch;
  while (cachedPixels > MAX_CACHE_PX && spriteCache.size > 1) {
    const [k0, v0] = spriteCache.entries().next().value;
    spriteCache.delete(k0);
    cachedPixels -= v0.w * v0.h;
  }
  return s;
}

function draw(canvas, l, lay, k) {
  const cw = canvas.width, ch = canvas.height;
  const ctx = canvas.getContext('2d');
  const center = () => ctx.setTransform(k, 0, 0, k, cw / 2, ch / 2);
  const sh = l.shadow || {};
  const shadowOn = (sh.blur || 0) > 0 || (sh.dist || 0) > 0;
  const setShadow = (c) => {
    const a = ((sh.angle || 0) * Math.PI) / 180;
    c.shadowColor = rgba(sh.color, (sh.opacity ?? 60) / 100);
    c.shadowBlur = (sh.blur || 0) * k; // shadows ignore the transform: pixels
    c.shadowOffsetX = Math.cos(a) * (sh.dist || 0) * k;
    c.shadowOffsetY = Math.sin(a) * (sh.dist || 0) * k;
  };
  const hasShape = l.shape.kind && l.shape.kind !== 'none';

  if (hasShape) {
    ctx.save(); center();
    if (shadowOn) setShadow(ctx);
    ctx.fillStyle = l.shape.color;
    shapePath(ctx, l.shape.kind, lay.boxW, lay.boxH, l.shape.pad || 0);
    ctx.fill();
    ctx.restore();
  }

  // Text group (extrude + outline + face) goes to its own canvas so the shadow falls from all of it at once.
  const g = document.createElement('canvas');
  g.width = cw; g.height = ch;
  const t = g.getContext('2d');
  t.setTransform(k, 0, 0, k, cw / 2, ch / 2);
  setFont(t, l);
  t.textBaseline = 'alphabetic';
  t.textAlign = l.align === 'left' ? 'left' : l.align === 'right' ? 'right' : 'center';
  t.lineJoin = 'round'; t.miterLimit = 2;
  const st = lay.st;
  t.scale(st, 1);
  const bw = lay.boxW / st;
  const x0 = l.align === 'left' ? -bw / 2 : l.align === 'right' ? bw / 2 : 0;
  const top = -lay.boxH / 2 + lay.cap;
  const each = (fn) => lay.lines.forEach((s, i) => fn(s, x0, top + i * lay.lh));
  const sw = l.stroke.width || 0;

  const depth = l.extrude.depth || 0;
  if (depth > 0) {
    const a = ((l.extrude.angle || 0) * Math.PI) / 180;
    const steps = Math.min(160, Math.max(2, Math.ceil(depth * k)));
    for (let i = steps; i >= 1; i--) {
      const d = (depth * i) / steps;
      const dx = (Math.cos(a) * d) / st, dy = Math.sin(a) * d;
      t.fillStyle = t.strokeStyle = shade(l.extrude.color, (i / steps) * 0.35);
      t.lineWidth = sw * 2;
      each((s, x, y) => { if (sw) t.strokeText(s, x + dx, y + dy); t.fillText(s, x + dx, y + dy); });
    }
  }
  if (sw > 0) {
    t.strokeStyle = l.stroke.color;
    t.lineWidth = sw * 2;
    each((s, x, y) => t.strokeText(s, x, y));
  }
  if (l.fill.gradient) {
    const gr = t.createLinearGradient(0, -lay.boxH / 2, 0, lay.boxH / 2);
    gr.addColorStop(0, l.fill.color); gr.addColorStop(1, l.fill.color2 || l.fill.color);
    t.fillStyle = gr;
  } else t.fillStyle = l.fill.color;
  each((s, x, y) => t.fillText(s, x, y));

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (shadowOn && !hasShape) {
    setShadow(ctx);
    ctx.drawImage(g, 0, 0);
    if (!(sh.dist > 0) && (sh.blur || 0) > 12) ctx.drawImage(g, 0, 0); // glow: a second pass reads as neon
  } else ctx.drawImage(g, 0, 0);
  ctx.restore();
}
