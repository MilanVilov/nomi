// Apple Photos-style crop overlay: drag body to move, drag corners or sides to resize,
// aspect presets. Vanilla, Pointer Events only.
//
// params.crop is stored in SOURCE space (unrotated image, normalized 0..1).
// The overlay works in DISPLAY space (the full, uncropped, rotated image
// shown in #cropLayer) and converts on every read/write via cropmath.js.
import {
  clamp01Rect, rotSteps, displayToSource, sourceToDisplay, displayAspect,
  centeredAspectRect, moveRect, resizeFromCorner, resizeFromEdge,
} from './cropmath.js';

// ratio: pixel width/height of the crop.
//   0    -> free (no lock)
//   null -> "original": lock to the displayed image's own aspect (flag original: true)
//   n>0  -> fixed ratio
export const ASPECTS = [
  { id: 'free', label: 'Free', ratio: 0 },
  { id: 'original', label: 'Original', ratio: null, original: true },
  { id: 'square', label: 'Square', ratio: 1 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
];

const FULL = () => ({ x: 0, y: 0, w: 1, h: 1 });
const isEl = (v) => typeof Element !== 'undefined' && v instanceof Element;

// attachCrop({layer, box, wrap|stage, params, onChange, getImageSize})
// or attachCrop(layer, box, wrap, params, onChange)
export function attachCrop(a, b, c, d, e) {
  const opts = isEl(a) ? { layer: a, box: b, wrap: c, params: d, onChange: e } : (a || {});
  const { layer, box, params, onChange } = opts;
  const wrap = opts.wrap || opts.stage || layer;
  const getImageSize = typeof opts.getImageSize === 'function' ? opts.getImageSize : null;

  const emit = () => { if (typeof onChange === 'function') onChange(); };
  const steps = () => rotSteps(params.rotation);
  const imgSize = () => {
    let s = null;
    try { s = getImageSize && getImageSize(); } catch { s = null; }
    return s && s.w > 0 && s.h > 0 ? s : { w: 1, h: 1 };
  };
  const dispAspect = () => { const s = imgSize(); return displayAspect(s.w, s.h, steps()); };
  const readDisp = () => {
    if (!params.crop) params.crop = FULL();
    return sourceToDisplay(clamp01Rect(params.crop), steps());
  };
  const writeDisp = (r) => { params.crop = displayToSource(clamp01Rect(r), steps()); };
  // Pixel ratio to lock to, or 0 for free.
  const lockRatio = () => {
    const id = params.aspect;
    if (!id || id === 'free') return 0;
    if (id === 'original') return dispAspect();
    const found = ASPECTS.find((x) => x.id === id);
    return found && found.ratio > 0 ? found.ratio : 0;
  };

  if (box && !box.querySelector('.crop-grid')) {
    const grid = document.createElement('div');
    grid.className = 'crop-grid';
    grid.style.pointerEvents = 'none';
    box.insertBefore(grid, box.firstChild);
  }

  function layout() {
    const r = readDisp();
    box.style.left = r.x * 100 + '%';
    box.style.top = r.y * 100 + '%';
    box.style.width = r.w * 100 + '%';
    box.style.height = r.h * 100 + '%';
    fitHandles();
  }
  // Hit areas are 44 screen px, but on a tiny box neighbouring corners would overlap and steal
  // each other's grab: shrink them to the box's smallest screen side (never below 14).
  function fitHandles() {
    const inv = parseFloat(layer.style.getPropertyValue('--inv')) || 1; // layer zoom = 1 / inv
    const m = Math.min(box.offsetWidth, box.offsetHeight) / inv;
    box.style.setProperty('--hs', Math.max(14, Math.min(44, m)) + 'px');
  }
  layout();
  // The editor zooms/unhides the layer without calling layout(): re-fit when its style/class changes.
  let mo = null;
  if (typeof MutationObserver !== 'undefined' && layer.nodeType === 1) {
    mo = new MutationObserver(fitHandles);
    mo.observe(layer, { attributes: true, attributeFilter: ['style', 'class'] });
  }

  const cleanups = [];
  const on = (el, type, fn, o) => {
    el.addEventListener(type, fn, o);
    cleanups.push(() => el.removeEventListener(type, fn, o));
  };

  let gesture = null; // active drag teardown
  let rafId = 0;
  const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f) => setTimeout(f, 16);
  const caf = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout;
  const emitThrottled = () => {
    if (rafId) return;
    rafId = raf(() => { rafId = 0; emit(); });
  };

  function onDown(e) {
    if (e.button != null && e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    e.stopPropagation();
    if (gesture) gesture(false);
    const handle = e.target && e.target.closest ? e.target.closest('.h') : null;
    const corner = handle ? ['tl', 'tr', 'bl', 'br'].find((k) => handle.classList.contains(k)) : null;
    const edge = handle && !corner ? ['t', 'r', 'b', 'l'].find((k) => handle.classList.contains(k)) : null;
    const target = e.currentTarget || box;
    const rect = wrap.getBoundingClientRect();
    const rw = rect.width || 1, rh = rect.height || 1;
    const start = readDisp();
    const lock = lockRatio();
    const dA = dispAspect();
    const sx = e.clientX, sy = e.clientY, id = e.pointerId;
    try { target.setPointerCapture(id); } catch {}

    const move = (ev) => {
      if (ev.pointerId !== id) return;
      const dx = (ev.clientX - sx) / rw, dy = (ev.clientY - sy) / rh;
      writeDisp(corner ? resizeFromCorner(start, corner, dx, dy, lock, dA)
        : edge ? resizeFromEdge(start, edge, dx, dy, lock, dA)
        : moveRect(start, dx, dy));
      layout();
      emitThrottled();
    };
    const end = (ev) => { if (ev.pointerId === id) finish(true); };
    const finish = (fire) => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
      try { target.releasePointerCapture(id); } catch {}
      gesture = null;
      if (rafId) { caf(rafId); rafId = 0; }
      if (fire) emit();
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
    gesture = finish;
  }

  on(box, 'pointerdown', onDown);
  for (const k of ['tl', 'tr', 'bl', 'br', 't', 'r', 'b', 'l']) {
    const h = box.querySelector('.h.' + k) || box.querySelector('.' + k);
    if (h) on(h, 'pointerdown', onDown);
  }

  function setAspect(id) {
    params.aspect = id || 'free';
    const dA = dispAspect();
    if (params.aspect === 'original') writeDisp(FULL());
    else {
      const ratio = lockRatio();
      if (ratio > 0) writeDisp(centeredAspectRect(ratio, dA));
    }
    layout();
    emit();
  }

  function reset() {
    params.crop = FULL();
    params.aspect = 'free';
    layout();
  }

  function destroy() {
    if (gesture) gesture(false);
    if (rafId) { caf(rafId); rafId = 0; }
    cleanups.forEach((fn) => fn());
    cleanups.length = 0;
    if (mo) mo.disconnect();
  }

  return { layout, setAspect, reset, destroy };
}
