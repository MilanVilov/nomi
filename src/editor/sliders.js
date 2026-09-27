// Adjustment slider config + renderer. Vanilla, no deps.
// Key names mirror store.js DEFAULTS.
export const ADJUSTMENTS = [
  { key: 'exposure', label: 'Exposure', min: -100, max: 100, def: 0 },
  { key: 'brilliance', label: 'Brilliance', min: -100, max: 100, def: 0 },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100, def: 0 },
  { key: 'shadows', label: 'Shadows', min: -100, max: 100, def: 0 },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100, def: 0 },
  { key: 'brightness', label: 'Brightness', min: -100, max: 100, def: 0 },
  { key: 'blackpoint', label: 'Black Point', min: -100, max: 100, def: 0 },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100, def: 0 },
  { key: 'vibrance', label: 'Vibrance', min: -100, max: 100, def: 0 },
  { key: 'warmth', label: 'Warmth', min: -100, max: 100, def: 0 },
  { key: 'tint', label: 'Tint', min: -100, max: 100, def: 0 },
];

// One labeled range row (same markup as the adjustment list). get/set read and write the value.
// def is where the accent fill starts; double-click resets to it.
export function makeSlider({ label, min, max, step = 1, def = 0, get, set, fmt = String, onInput }) {
  const row = document.createElement('label');
  row.className = 'slider';
  const top = document.createElement('span');
  const name = document.createElement('i');
  name.style.fontStyle = 'normal';
  name.textContent = label;
  const badge = document.createElement('b');
  top.append(name, badge);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.setAttribute('aria-label', label);

  const paint = () => {
    const v = get() ?? def;
    badge.textContent = fmt(v);
    row.classList.toggle('changed', v !== def);
    // Fill from the default to the current value.
    const pct = (x) => `${((Math.min(max, Math.max(min, x)) - min) / (max - min)) * 100}%`;
    input.style.setProperty('--lo', pct(Math.min(v, def)));
    input.style.setProperty('--hi', pct(Math.max(v, def)));
  };
  const sync = () => { input.value = String(get() ?? def); paint(); };
  sync();

  input.addEventListener('input', () => { set(Number(input.value)); paint(); if (onInput) onInput(); });
  row.addEventListener('dblclick', () => { set(def); sync(); if (onInput) onInput(); });
  row.append(top, input);
  return { el: row, input, sync };
}

// Render labeled range inputs into container. Mutates params live.
// onChange() is throttled via requestAnimationFrame.
export function buildSliders(container, params, onChange) {
  container.innerHTML = '';
  let scheduled = false;
  const emit = () => {
    if (typeof onChange !== 'function') return;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      onChange();
    });
  };

  const rows = [];
  for (const adj of ADJUSTMENTS) {
    const row = makeSlider({
      label: adj.label, min: adj.min, max: adj.max, def: adj.def,
      get: () => params[adj.key] ?? adj.def,
      set: (v) => { params[adj.key] = v; },
      onInput: emit,
    });
    container.append(row.el);
    rows.push(row);
  }

  return {
    update() { rows.forEach((r) => r.sync()); },
  };
}
