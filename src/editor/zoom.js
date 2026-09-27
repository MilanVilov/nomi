// Inspect zoom for the editor stage: click zooms in at the pointer, drag pans, wheel zooms out (or in).
// View = { s, tx, ty }: CSS `translate(tx, ty) scale(s)` on the canvas, origin at its center.
// Pure math first (importable in Node), DOM wiring below.

export const MAX_ZOOM = 8;
const CLICK_STEP = 2;
const DRAG_PX = 4;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Keep the photo covering the view: no panning past an edge, centered on an axis that fits.
export function clampView(v, cw, ch, vw, vh) {
  const s = clamp(v.s, 1, MAX_ZOOM);
  if (s <= 1.001) return { s: 1, tx: 0, ty: 0 };
  const mx = Math.max(0, (s * cw - vw) / 2), my = Math.max(0, (s * ch - vh) / 2);
  return { s, tx: clamp(v.tx, -mx, mx), ty: clamp(v.ty, -my, my) };
}

// Zoom to scale `s` keeping the photo point under (qx, qy) fixed. q is relative to the canvas's layout center.
export function zoomAt(v, s, qx, qy) {
  const k = s / v.s;
  return { s, tx: qx - (qx - v.tx) * k, ty: qy - (qy - v.ty) * k };
}

// Wiring. `enabled()` says whether the canvas is free to take clicks (not while cropping / placing text).
export function attachZoom({ wrap, canvas, enabled }) {
  let v = { s: 1, tx: 0, ty: 0 };
  let drag = null;

  const layoutCenter = () => {
    const r = wrap.getBoundingClientRect();
    return {
      x: r.left + canvas.offsetLeft + canvas.offsetWidth / 2,
      y: r.top + canvas.offsetTop + canvas.offsetHeight / 2,
    };
  };

  function apply(next, animate) {
    v = clampView(next, canvas.offsetWidth, canvas.offsetHeight, wrap.clientWidth, wrap.clientHeight);
    wrap.classList.toggle('zoom-anim', !!animate);
    wrap.classList.toggle('zoomed', v.s > 1);
    canvas.style.transform = v.s > 1 ? `translate(${v.tx}px, ${v.ty}px) scale(${v.s})` : '';
  }

  function zoomTo(s, clientX, clientY, animate) {
    const c = layoutCenter();
    apply(zoomAt(v, clamp(s, 1, MAX_ZOOM), clientX - c.x, clientY - c.y), animate);
  }

  function onDown(e) {
    if (e.button !== 0 || e.target !== canvas || !enabled()) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, tx: v.tx, ty: v.ty, moved: false };
    canvas.setPointerCapture(e.pointerId);
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_PX) return;
    drag.moved = true;
    if (v.s <= 1) return;
    wrap.classList.add('panning');
    apply({ s: v.s, tx: drag.tx + dx, ty: drag.ty + dy }, false);
  }

  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const clicked = !drag.moved && e.type === 'pointerup';
    drag = null;
    wrap.classList.remove('panning');
    if (clicked && v.s < MAX_ZOOM) zoomTo(v.s * CLICK_STEP, e.clientX, e.clientY, true);
  }

  function onWheel(e) {
    if (!enabled() || !(v.s > 1 || e.deltaY < 0)) return;
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY; // lines -> px
    zoomTo(v.s * Math.exp(-dy * 0.0025), e.clientX, e.clientY, false);
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  wrap.addEventListener('wheel', onWheel, { passive: false });

  return {
    // Back to fit. Leaves the transform alone when not zoomed (crop view owns it then).
    reset() {
      drag = null;
      wrap.classList.remove('panning', 'zoom-anim');
      if (v.s > 1) apply({ s: 1, tx: 0, ty: 0 }, false);
    },
    isZoomed: () => v.s > 1,
  };
}
