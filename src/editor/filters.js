// iOS Photos-style filter set + filter strip UI. Vanilla, no deps.
// Order = shader index (gl.js uFilter). Index 0 must stay 'original' (no-op).
export const FILTERS = [
  { id: 'original', label: 'Original' },
  { id: 'vivid', label: 'Vivid' },
  { id: 'vividWarm', label: 'Vivid Warm' },
  { id: 'vividCool', label: 'Vivid Cool' },
  { id: 'dramatic', label: 'Dramatic' },
  { id: 'dramaticWarm', label: 'Dramatic Warm' },
  { id: 'dramaticCool', label: 'Dramatic Cool' },
  { id: 'mono', label: 'Mono' },
  { id: 'silvertone', label: 'Silvertone' },
  { id: 'noir', label: 'Noir' },
];

const INDEX = new Map(FILTERS.map((f, i) => [f.id, i]));

// Shader index for a filter id; unknown/missing -> 0 (original).
export function filterIndex(id) {
  return INDEX.get(id) ?? 0;
}

const DEF_AMOUNT = 100;

// Builds the preview row + intensity slider into container (replacing its contents).
// renderPreview(filterId, canvas) is optional; without it thumbnails stay blank.
export function buildFilterStrip(container, { params, onChange, renderPreview } = {}) {
  container.innerHTML = '';
  let scheduled = false;
  const emit = () => {
    if (typeof onChange !== 'function' || scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      onChange();
    });
  };
  const current = () => FILTERS[filterIndex(params.filter)].id;
  const amount = () => {
    const v = Number(params.filterAmount);
    return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : DEF_AMOUNT;
  };

  const row = document.createElement('div');
  row.className = 'filter-row';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'Filters');

  const items = FILTERS.map((f) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'filter';
    btn.dataset.id = f.id;
    const canvas = document.createElement('canvas');
    canvas.className = 'filter-thumb';
    const name = document.createElement('span');
    name.className = 'filter-name';
    name.textContent = f.label;
    btn.append(canvas, name);
    btn.addEventListener('click', () => {
      params.filter = f.id;
      if (params.filterAmount == null) params.filterAmount = DEF_AMOUNT;
      sync();
      emit();
    });
    row.append(btn);
    return { f, btn, canvas };
  });

  // Intensity slider, same markup as sliders.js so existing CSS applies.
  const label = document.createElement('label');
  label.className = 'slider filter-amount';
  const top = document.createElement('span');
  const nm = document.createElement('i');
  nm.style.fontStyle = 'normal';
  nm.textContent = 'Intensity';
  const badge = document.createElement('b');
  top.append(nm, badge);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '100';
  input.step = '1';
  input.setAttribute('aria-label', 'Filter intensity');
  label.append(top, input);

  const paintSlider = () => {
    const v = amount();
    input.value = String(v);
    badge.textContent = String(v);
    label.classList.toggle('changed', v !== DEF_AMOUNT);
    input.style.setProperty('--lo', '0%'); // min-based fill
    input.style.setProperty('--hi', `${v}%`);
    label.hidden = current() === 'original';
  };
  input.addEventListener('input', () => {
    params.filterAmount = Number(input.value);
    paintSlider();
    emit();
  });
  label.addEventListener('dblclick', () => {
    params.filterAmount = DEF_AMOUNT;
    paintSlider();
    emit();
  });

  function sync() {
    const id = current();
    for (const it of items) {
      const on = it.f.id === id;
      it.btn.classList.toggle('active', on);
      it.btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    paintSlider();
  }

  function refresh() {
    if (typeof renderPreview !== 'function') return;
    for (const it of items) {
      try { renderPreview(it.f.id, it.canvas); } catch { /* leave blank */ }
    }
  }

  container.append(row, label);
  sync();
  refresh();

  return { update: sync, refresh };
}
