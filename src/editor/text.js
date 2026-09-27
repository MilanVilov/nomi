// Text layers: rail panel + on-stage gizmo. Layers live in params.texts (plain JSON, source space),
// so undo, duplicate and export need nothing special. Rendering happens in gl.js (renderTexts).
//
// Placement modes:
//   2d   - move / rotate / scale handles
//   tilt - same, plus rotateX / rotateY / perspective sliders (a card turned in 3D)
//   pin  - four free corners you drag onto a wall, sign or floor (text painted into the scene)
import { FONTS, PRESETS, SHAPES, newLayer, applyPreset, preloadFontCSS } from './textsprite.js';
import { apply, isConvexQuad, pointInQuad, quadCenter, displayAngle, displayScale } from './textmath.js';
import { layerQuad } from './gl.js';
import { makeSlider } from './sliders.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// getFrame() -> { map: frameMap(...), imgW, imgH } for the frame currently on screen, or null.
export function attachText({ layer, panel, params, getFrame, onChange }) {
  let selected = null;
  let syncers = [];
  const texts = () => (Array.isArray(params.texts) ? params.texts : (params.texts = []));
  const cur = () => texts().find((l) => l.id === selected) || null;
  const emit = () => { if (typeof onChange === 'function') onChange(); };

  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'tx-svg');
  svg.setAttribute('viewBox', '0 0 1 1');
  svg.setAttribute('preserveAspectRatio', 'none');
  const handles = el('div', 'tx-handles');
  layer.replaceChildren(svg, handles);

  // ---------- geometry helpers ----------
  const frameQuads = (f) => texts().map((l) => ({
    l, q: layerQuad(l, f.imgW, f.imgH),
  })).map((o) => ({ ...o, t: o.q.map(([x, y]) => apply(f.map.toOut, x, y)) }));

  const pointerT = (e) => {
    const r = layer.getBoundingClientRect();
    return [(e.clientX - r.left) / (r.width || 1), (e.clientY - r.top) / (r.height || 1)];
  };

  // ---------- gizmo ----------
  function layout() {
    const f = getFrame();
    svg.replaceChildren();
    handles.replaceChildren();
    if (!f) return;
    const W = layer.clientWidth || 1, H = layer.clientHeight || 1;
    for (const { l, t } of frameQuads(f)) {
      const poly = document.createElementNS(SVGNS, 'polygon');
      poly.setAttribute('points', t.map((p) => p.join(',')).join(' '));
      poly.setAttribute('class', 'tx-quad' + (l.id === selected ? ' sel' : ''));
      svg.appendChild(poly);
      if (l.id !== selected) continue;
      const add = (kind, x, y, i) => {
        const h = el('span', 'tx-h ' + kind);
        h.dataset.kind = kind;
        if (i != null) h.dataset.i = String(i);
        h.style.left = x * 100 + '%';
        h.style.top = y * 100 + '%';
        handles.appendChild(h);
      };
      if (l.place.mode === 'pin') t.forEach(([x, y], i) => add('pin', x, y, i));
      else {
        add('scale', t[2][0], t[2][1]);
        // Rotate handle sits 32px beyond the middle of the top edge, pointing away from the centre.
        const mx = (t[0][0] + t[1][0]) / 2, my = (t[0][1] + t[1][1]) / 2;
        const c = apply(f.map.toOut, l.place.cx, l.place.cy);
        let dx = (mx - c[0]) * W, dy = (my - c[1]) * H;
        const n = Math.hypot(dx, dy) || 1;
        dx /= n; dy /= n;
        add('rot', mx + (dx * 32) / W, my + (dy * 32) / H);
      }
    }
  }

  function hitLayer(f, t) {
    const all = frameQuads(f);
    for (let i = all.length - 1; i >= 0; i--) if (pointInQuad(all[i].t, t[0], t[1])) return all[i].l;
    return null;
  }

  let gesture = null;
  function onDown(e) {
    if (e.button != null && e.button !== 0 && e.pointerType === 'mouse') return;
    const f = getFrame();
    if (!f) return;
    e.preventDefault();
    if (gesture) gesture();
    const t0 = pointerT(e);
    const h = e.target.closest ? e.target.closest('.tx-h') : null;
    let l = cur();
    let kind = h ? h.dataset.kind : 'move';
    if (!h) {
      const hit = hitLayer(f, t0);
      if (!hit) { select(null); return; }
      if (hit.id !== selected) select(hit.id);
      l = hit;
    }
    if (!l) return;
    const pl = l.place;
    const start = structuredClone(pl);
    const s0 = apply(f.map.toSrc, t0[0], t0[1]);
    const W = layer.clientWidth || 1, H = layer.clientHeight || 1;
    const cT = pl.mode === 'pin' ? null : apply(f.map.toOut, pl.cx, pl.cy);
    const ang = (t) => Math.atan2((t[1] - cT[1]) * H, (t[0] - cT[0]) * W) * 180 / Math.PI;
    const dist = (t) => Math.hypot((t[0] - cT[0]) * W, (t[1] - cT[1]) * H);
    const a0 = cT && ang(t0), d0 = cT && Math.max(1, dist(t0));
    const phi = displayAngle(f.map.toOut, f.map.outW, f.map.outH, f.imgW, f.imgH);
    const idx = h && h.dataset.i != null ? Number(h.dataset.i) : -1;
    const id = e.pointerId, target = layer;
    try { target.setPointerCapture(id); } catch {}

    const move = (ev) => {
      if (ev.pointerId !== id) return;
      const t = pointerT(ev);
      const s = apply(f.map.toSrc, t[0], t[1]);
      if (kind === 'move') {
        const dx = s[0] - s0[0], dy = s[1] - s0[1];
        if (pl.mode === 'pin') pl.quad = start.quad.map(([x, y]) => [x + dx, y + dy]);
        else { pl.cx = start.cx + dx; pl.cy = start.cy + dy; }
      } else if (kind === 'rot') {
        let r = start.rot + (ang(t) - a0);
        // Snap to level / plumb on screen unless Shift is held.
        const onScreen = r + phi, snap = Math.round(onScreen / 90) * 90;
        if (!ev.shiftKey && Math.abs(onScreen - snap) < 3) r = snap - phi;
        pl.rot = ((r + 540) % 360) - 180;
      } else if (kind === 'scale') {
        pl.size = clamp(start.size * (dist(t) / d0), 0.004, 4);
      } else if (kind === 'pin' && idx >= 0) {
        const q = start.quad.map((p) => p.slice());
        q[idx] = s;
        if (isConvexQuad(q, f.imgW, f.imgH)) pl.quad = q;
      }
      syncControls();
      emit();
    };
    const end = (ev) => { if (ev.pointerId === id) finish(); };
    const finish = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
      try { target.releasePointerCapture(id); } catch {}
      gesture = null;
      emit();
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
    gesture = finish;
  }

  function onDbl(e) {
    const f = getFrame();
    if (!f) return;
    const t = pointerT(e);
    const hit = hitLayer(f, t);
    if (hit) { select(hit.id); focusText(); return; }
    addLayer(apply(f.map.toSrc, t[0], t[1]));
  }

  layer.addEventListener('pointerdown', onDown);
  layer.addEventListener('dblclick', onDbl);

  // ---------- layer ops ----------
  function addLayer(at) {
    const f = getFrame();
    if (!f) return;
    const c = at || apply(f.map.toSrc, 0.5, 0.5);
    const phi = displayAngle(f.map.toOut, f.map.outW, f.map.outH, f.imgW, f.imgH);
    const scale = displayScale(f.map.toOut, f.map.outW, f.map.outH, f.imgW);
    const base = cur();
    // New text inherits the selected layer's look, so a second line matches the first.
    const l = base ? { ...structuredClone(base), id: newLayer().id, text: 'your text' } : newLayer();
    l.place = { ...l.place, mode: '2d', quad: null, cx: c[0], cy: c[1],
      size: (0.1 * f.map.outH) / scale / f.imgH, rot: Math.round(-phi * 100) / 100 };
    params.texts = [...texts(), l];
    select(l.id);
    focusText();
    emit();
  }

  function removeSelected() {
    const list = texts();
    const i = list.findIndex((l) => l.id === selected);
    if (i < 0) return false;
    params.texts = list.filter((_, j) => j !== i);
    const next = params.texts[Math.min(i, params.texts.length - 1)];
    select(next ? next.id : null);
    emit();
    return true;
  }

  function duplicateSelected() {
    const l = cur();
    const f = getFrame();
    if (!l || !f) return;
    const c = structuredClone(l);
    c.id = newLayer().id;
    const d = apply(f.map.toSrc, 0.53, 0.53), o = apply(f.map.toSrc, 0.5, 0.5);
    const dx = d[0] - o[0], dy = d[1] - o[1];
    c.place.cx += dx; c.place.cy += dy;
    if (c.place.quad) c.place.quad = c.place.quad.map(([x, y]) => [x + dx, y + dy]);
    params.texts = [...texts(), c];
    select(c.id);
    emit();
  }

  function setMode(l, mode) {
    const f = getFrame();
    const pl = l.place;
    if (mode === pl.mode || !f) return;
    if (mode === 'pin') pl.quad = layerQuad(l, f.imgW, f.imgH);
    else if (pl.mode === 'pin' && pl.quad) [pl.cx, pl.cy] = quadCenter(pl.quad);
    pl.mode = mode;
  }

  // ---------- panel ----------
  function select(id) {
    selected = id;
    buildPanel();
    layout();
  }

  function focusText() {
    const ta = panel.querySelector('.tx-input textarea');
    if (ta) { ta.focus(); ta.select(); }
  }

  function syncControls() { syncers.forEach((fn) => fn()); }

  function group(title, ...kids) {
    const g = el('div', 'group');
    g.append(el('div', 'group-title', title), ...kids.filter(Boolean));
    return g;
  }

  function chips(options, get, set, { rebuild = false, label } = {}) {
    const row = el('div', 'chips');
    if (label) row.setAttribute('aria-label', label);
    row.setAttribute('role', 'group');
    const paint = () => {
      for (const b of row.children) b.classList.toggle('active', b.dataset.id === String(get()));
    };
    for (const o of options) {
      const b = el('button', 'chip' + (o.cls ? ' ' + o.cls : ''), o.label);
      b.type = 'button';
      b.dataset.id = String(o.id);
      if (o.style) Object.assign(b.style, o.style);
      b.addEventListener('click', () => {
        set(o.id);
        if (rebuild) { buildPanel(); layout(); } else paint();
        emit();
      });
      row.appendChild(b);
    }
    paint();
    syncers.push(paint);
    return row;
  }

  function toggle(label, get, set, rebuild = false) {
    const b = el('button', 'chip', label);
    b.type = 'button';
    const paint = () => { b.classList.toggle('active', !!get()); b.setAttribute('aria-pressed', String(!!get())); };
    b.addEventListener('click', () => { set(!get()); if (rebuild) buildPanel(); else paint(); emit(); });
    paint();
    syncers.push(paint);
    return b;
  }

  function slider(label, min, max, def, get, set, fmt, step = 1) {
    const s = makeSlider({ label, min, max, def, step, get, set, fmt, onInput: emit });
    syncers.push(s.sync);
    return s.el;
  }

  function color(label, get, set) {
    const row = el('label', 'tx-color');
    const input = el('input');
    input.type = 'color';
    input.setAttribute('aria-label', label);
    const sync = () => { input.value = get() || '#000000'; };
    sync();
    input.addEventListener('input', () => { set(input.value); emit(); });
    row.append(el('i', null, label), input);
    syncers.push(sync);
    return row;
  }

  function buildPanel() {
    syncers = [];
    panel.replaceChildren();
    const l = cur();

    const actions = el('div', 'tx-actions');
    const bAdd = el('button', 'btn primary', 'Add text');
    bAdd.addEventListener('click', () => addLayer());
    actions.append(bAdd);
    if (l) {
      const bDup = el('button', 'btn ghost', '⧉ duplicate');
      bDup.addEventListener('click', duplicateSelected);
      const bDel = el('button', 'btn ghost danger', 'delete');
      bDel.addEventListener('click', removeSelected);
      actions.append(bDup, bDel);
    }
    panel.append(actions);

    if (texts().length) {
      const list = el('div', 'tx-list');
      list.setAttribute('role', 'listbox');
      list.setAttribute('aria-label', 'Text layers');
      for (const t of texts()) {
        const b = el('button', 'chip tx-item' + (t.id === selected ? ' active' : ''), (t.text || '').split('\n')[0] || '(empty)');
        b.type = 'button';
        b.setAttribute('role', 'option');
        b.setAttribute('aria-selected', String(t.id === selected));
        b.addEventListener('click', () => select(t.id));
        list.append(b);
      }
      panel.append(group('layers', list));
    }

    if (!l) {
      panel.append(el('p', 'hint', 'add text, then drag it on the photo · double-click the photo to add text there'));
      return;
    }
    const pl = l.place;

    // Text
    const box = el('div', 'tx-input');
    const ta = el('textarea');
    ta.rows = 2;
    ta.value = l.text;
    ta.setAttribute('aria-label', 'Text');
    ta.spellcheck = false;
    ta.addEventListener('input', () => {
      l.text = ta.value;
      const row = panel.querySelector('.tx-item.active');
      if (row) row.textContent = ta.value.split('\n')[0] || '(empty)';
      emit();
    });
    box.append(ta);
    panel.append(box);

    panel.append(group('style', chips(PRESETS.map((p) => ({ id: p.id, label: p.label })), () => null,
      (id) => applyPreset(l, id), { rebuild: true, label: 'Presets' })));

    preloadFontCSS();
    panel.append(group('font',
      chips(FONTS.map((f) => ({ id: f.id, label: f.label, cls: 'font', style: { fontFamily: `"${f.family}", var(--font)` } })),
        () => l.font, (v) => { l.font = v; }, { label: 'Font' }),
      (() => {
        const r = el('div', 'chips');
        r.append(
          toggle('bold', () => l.bold, (v) => { l.bold = v; }),
          toggle('italic', () => l.italic, (v) => { l.italic = v; }),
          toggle('caps', () => l.caps, (v) => { l.caps = v; }),
        );
        return r;
      })(),
      chips([{ id: 'left', label: 'left' }, { id: 'center', label: 'center' }, { id: 'right', label: 'right' }],
        () => l.align, (v) => { l.align = v; }, { label: 'Align' }),
      slider('size', 0.5, 60, 10, () => Math.round(pl.size * 1000) / 10, (v) => { pl.size = v / 100; }, (v) => v.toFixed(1), 0.1),
      slider('tracking', -10, 60, 0, () => l.tracking, (v) => { l.tracking = v; }),
      slider('line height', 60, 220, 110, () => l.lineHeight, (v) => { l.lineHeight = v; }, (v) => v + '%'),
      slider('width', 40, 160, 100, () => l.stretch, (v) => { l.stretch = v; }, (v) => v + '%'),
    ));

    panel.append(group('color',
      color('fill', () => l.fill.color, (v) => { l.fill.color = v; }),
      toggle('gradient', () => l.fill.gradient, (v) => { l.fill.gradient = v; }, true),
      l.fill.gradient && color('fill 2', () => l.fill.color2, (v) => { l.fill.color2 = v; }),
    ));

    panel.append(group('outline',
      slider('width', 0, 30, 0, () => l.stroke.width, (v) => { l.stroke.width = v; }),
      color('color', () => l.stroke.color, (v) => { l.stroke.color = v; }),
    ));

    panel.append(group('shadow · glow',
      slider('blur', 0, 80, 0, () => l.shadow.blur, (v) => { l.shadow.blur = v; }),
      slider('distance', 0, 60, 0, () => l.shadow.dist, (v) => { l.shadow.dist = v; }),
      slider('angle', 0, 360, 45, () => l.shadow.angle, (v) => { l.shadow.angle = v; }, (v) => v + '°'),
      slider('opacity', 0, 100, 60, () => l.shadow.opacity, (v) => { l.shadow.opacity = v; }, (v) => v + '%'),
      color('color', () => l.shadow.color, (v) => { l.shadow.color = v; }),
    ));

    panel.append(group('shape',
      chips(SHAPES.map((s) => ({ id: s, label: s })), () => l.shape.kind, (v) => { l.shape.kind = v; }, { label: 'Shape' }),
      slider('padding', 0, 100, 30, () => l.shape.pad, (v) => { l.shape.pad = v; }),
      color('color', () => l.shape.color, (v) => { l.shape.color = v; }),
    ));

    panel.append(group('3d extrude',
      slider('depth', 0, 80, 0, () => l.extrude.depth, (v) => { l.extrude.depth = v; }),
      slider('angle', 0, 360, 45, () => l.extrude.angle, (v) => { l.extrude.angle = v; }, (v) => v + '°'),
      color('color', () => l.extrude.color, (v) => { l.extrude.color = v; }),
    ));

    const placeKids = [
      chips([{ id: '2d', label: '2d' }, { id: 'tilt', label: 'tilt 3d' }, { id: 'pin', label: 'pin to surface' }],
        () => pl.mode, (v) => setMode(l, v), { rebuild: true, label: 'Placement' }),
    ];
    if (pl.mode !== 'pin') {
      placeKids.push(slider('rotate', -180, 180, 0, () => Math.round(pl.rot * 10) / 10, (v) => { pl.rot = v; }, (v) => v + '°', 0.5));
    }
    if (pl.mode === 'tilt') {
      placeKids.push(
        slider('tilt x', -75, 75, 0, () => pl.rx, (v) => { pl.rx = v; }, (v) => v + '°'),
        slider('tilt y', -75, 75, 0, () => pl.ry, (v) => { pl.ry = v; }, (v) => v + '°'),
        slider('perspective', 0, 100, 60, () => pl.persp, (v) => { pl.persp = v; }),
      );
    }
    if (pl.mode === 'pin') {
      const reset = el('button', 'btn ghost', '↺ square corners');
      reset.addEventListener('click', () => {
        const f = getFrame();
        if (!f) return;
        pl.quad = layerQuad({ ...l, place: { ...pl, mode: '2d' } }, f.imgW, f.imgH);
        emit();
      });
      placeKids.push(el('p', 'hint', 'drag the four corners onto the edges of a wall, sign or floor'), el('div', null), reset);
    }
    panel.append(group('placement', ...placeKids));

    panel.append(group('blend',
      chips(['normal', 'multiply', 'screen', 'overlay'].map((m) => ({ id: m, label: m })),
        () => l.blend.mode, (v) => { l.blend.mode = v; }, { label: 'Blend mode' }),
      slider('opacity', 0, 100, 100, () => l.blend.opacity, (v) => { l.blend.opacity = v; }, (v) => v + '%'),
      slider('surface texture', 0, 100, 0, () => l.blend.texture, (v) => { l.blend.texture = v; }),
      slider('scene light', 0, 100, 0, () => l.blend.light, (v) => { l.blend.light = v; }),
    ));
    panel.append(el('p', 'hint', 'drag to move · ↻ rotates · corner scales · shift turns off snapping · ⌫ deletes'));
  }

  // After undo/redo/reset replaced params.texts.
  function refresh() {
    if (selected && !cur()) selected = null;
    buildPanel();
    layout();
  }

  function destroy() {
    if (gesture) gesture();
    layer.removeEventListener('pointerdown', onDown);
    layer.removeEventListener('dblclick', onDbl);
    layer.replaceChildren();
    panel.replaceChildren();
  }

  buildPanel();
  return { layout, refresh, destroy, addLayer, removeSelected, select, hasSelection: () => !!cur() };
}
