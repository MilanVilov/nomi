import { state, uid, defaultParams, isEdited, duplicatePhoto, deletePhoto, restorePhoto, isUrlInUse } from './store.js';
import { revokePhoto, looksLikeImage } from './importer.js';
import { importFiles } from './importer.js';
import { createEngine } from './editor/gl.js';
import { buildSliders } from './editor/sliders.js';
import { ASPECTS, attachCrop } from './editor/crop.js';
import { buildFilterStrip } from './editor/filters.js';
import { attachText } from './editor/text.js';
import { attachZoom } from './editor/zoom.js';
import { setFontListener } from './editor/textsprite.js';
import { frameMap } from './editor/textmath.js';
import { supportsFolders, openFolder, ensurePermission, saveInPlace, BACKUP_DIR } from './folder.js';
import { exportAlbumZip } from './exporter.js';
import { thumbSize, justifyRows, outputSize, rotSteps, sourceToDisplay } from './editor/cropmath.js';

const $ = (id) => document.getElementById(id);
const viewAlbums = $('viewAlbums'), viewAlbum = $('viewAlbum'), viewEditor = $('viewEditor');
const albumGrid = $('albumGrid'), emptyAlbums = $('emptyAlbums'), btnNewAlbum = $('btnNewAlbum'), btnDemo = $('btnDemo');
const albumName = $('albumName'), albumMeta = $('albumMeta'), photoGrid = $('photoGrid'), fileInput = $('fileInput');
const btnBackAlbums = $('btnBackAlbums'), btnDownloadAlbum = $('btnDownloadAlbum'), dropHint = $('dropHint'), crumb = $('crumb');
const edName = $('edName'), btnBackAlbum = $('btnBackAlbum'), btnReset = $('btnReset'), btnDone = $('btnDone');
const glCanvas = $('glCanvas'), cropLayer = $('cropLayer'), cropBox = $('cropBox'), stageWrap = $('stageWrap');
const tabAdjust = $('tabAdjust'), tabCrop = $('tabCrop'), panelAdjust = $('panelAdjust'), panelCrop = $('panelCrop');
const tabFilters = $('tabFilters'), panelFilters = $('panelFilters');
const tabText = $('tabText'), panelText = $('panelText'), textLayer = $('textLayer');
const btnUndo = $('btnUndo'), btnRedo = $('btnRedo'), btnPrev = $('btnPrev'), btnNext = $('btnNext');
const btnOpenFolder = $('btnOpenFolder'), importLabel = fileInput.closest('label'), exportMenu = $('exportMenu'), exportTitle = $('exportTitle');
const aspectRow = $('aspectRow'), btnRot = $('btnRot'), inStraighten = $('inStraighten'), vStraighten = $('vStraighten');
const filmstrip = $('filmstrip'), toastEl = $('toast'), btnDuplicate = $('btnDuplicate');
const btnSelect = $('btnSelect'), selectBar = $('selectBar'), selCount = $('selCount');
const btnSelAll = $('btnSelAll'), btnSelExport = $('btnSelExport'), btnSelDelete = $('btnSelDelete'), btnSelDone = $('btnSelDone');

const FULL = { x: 0, y: 0, w: 1, h: 1 };
const GALLERY_GAP = 2;
const BG = [41, 44, 51]; // --bg, used to soften the sampled edge color
let zoom = null, engine = null, sliders = null, cropApi = null, filterStrip = null, textApi = null;
let previewEngine = null, previewReady = false, tab = 'adjust';
let history = [], future = [], commitT = 0, pointerDown = false;
let cropAdjusting = false, settleT = 0, openSeq = 0, navTarget = null;
let menuIds = null, lastExport = 'folder', saving = false;
let raf = 0, cropMode = false, snapshot = null, toastT = 0, toastSpin = 0;
let selecting = false, importing = null, exporting = false, galleryRaf = 0;
const selected = new Set();
const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
const curPhoto = () => state.photos.get(state.activePhoto);

// Status bar. busy: stays up with a braille spinner until the next toast.
// action: { label, run } adds an inline button (e.g. undo).
function toast(msg, { busy = false, action = null, ms = 2600 } = {}) {
  clearTimeout(toastT);
  clearInterval(toastSpin);
  toastEl.replaceChildren();
  toastEl.classList.toggle('busy', busy);
  if (busy) {
    const spin = document.createElement('span');
    spin.className = 'spin';
    let i = 0;
    spin.textContent = SPIN[0];
    toastSpin = setInterval(() => { spin.textContent = SPIN[++i % SPIN.length]; }, 80);
    toastEl.append(spin);
  }
  toastEl.append(msg);
  if (action) {
    const b = document.createElement('button');
    b.className = 'toast-action';
    b.textContent = action.label;
    b.addEventListener('click', () => { hideToast(); action.run(); });
    toastEl.append(b);
  }
  toastEl.classList.remove('hidden');
  if (!busy) toastT = setTimeout(() => { hideToast(); if (action && action.expire) action.expire(); }, ms);
}

function hideToast() {
  clearTimeout(toastT);
  clearInterval(toastSpin);
  toastEl.classList.add('hidden');
}

// Small spinner inside a button while work runs; returns a function that updates its label.
function busyButton(btn, label) {
  const original = btn.textContent;
  btn.classList.add('busy');
  btn.setAttribute('aria-busy', 'true');
  btn.disabled = true;
  const spin = document.createElement('span');
  spin.className = 'spin';
  const text = document.createElement('span');
  btn.replaceChildren(spin, text);
  let i = 0;
  spin.textContent = SPIN[0];
  const t = setInterval(() => { spin.textContent = SPIN[++i % SPIN.length]; }, 80);
  const set = (l) => { text.textContent = l; };
  set(label);
  set.done = () => {
    clearInterval(t);
    btn.classList.remove('busy');
    btn.removeAttribute('aria-busy');
    btn.disabled = false;
    btn.textContent = original;
  };
  return set;
}

function show(id) {
  viewAlbums.classList.toggle('hidden', id !== 'viewAlbums');
  viewAlbum.classList.toggle('hidden', id !== 'viewAlbum');
  viewEditor.classList.toggle('hidden', id !== 'viewEditor');
  const al = state.albums.get(state.activeAlbum);
  crumb.textContent = id === 'viewAlbums' ? 'albums' : `albums / ${al ? al.name : ''}`;
  btnDownloadAlbum.classList.toggle('hidden', id !== 'viewAlbum' || !al || !al.photoIds.length);
}

window.addEventListener('beforeunload', (e) => {
  for (const ph of state.photos.values()) if (isEdited(ph)) { e.preventDefault(); e.returnValue = ''; return; }
});

// --- albums ---
function renderAlbums() {
  albumGrid.innerHTML = '';
  const list = [...state.albums.values()];
  emptyAlbums.classList.toggle('hidden', list.length > 0);
  for (const al of list) {
    const card = document.createElement('div');
    card.className = 'album-card';
    card.innerHTML = '<div class="thumbs"></div><h3></h3><div class="meta"></div>';
    const thumbs = card.querySelector('.thumbs');
    for (const pid of al.photoIds.slice(0, 3)) {
      const p = state.photos.get(pid);
      if (!p) continue;
      const img = document.createElement('img');
      img.src = p.thumbUrl || p.url; img.alt = '';
      thumbs.appendChild(img);
    }
    card.querySelector('h3').textContent = al.name;
    card.querySelector('.meta').textContent = `${al.photoIds.length} photo${al.photoIds.length === 1 ? '' : 's'}`;
    card.addEventListener('click', () => openAlbum(al.id));
    albumGrid.appendChild(card);
  }
}

function openAlbum(id) {
  state.activeAlbum = id;
  state.activePhoto = null;
  renderAlbumDetail();
}

function renderAlbumDetail() {
  const al = state.albums.get(state.activeAlbum);
  if (!al) { renderAlbums(); show('viewAlbums'); return; }
  if (document.activeElement !== albumName) albumName.value = al.name;
  renderAlbumMeta();
  show('viewAlbum');
  syncSelectUI();
  layoutGallery();
}

function renderAlbumMeta() {
  const al = state.albums.get(state.activeAlbum);
  if (!al) return;
  const n = al.photoIds.length;
  let text = `${n} photo${n === 1 ? '' : 's'}`;
  if (al.folder) text += ` · folder “${al.folder}” · edits can be saved back`;
  if (importing && importing.albumId === al.id) text += ` · importing ${importing.done}/${importing.total}`;
  albumMeta.textContent = text;
  btnDownloadAlbum.classList.toggle('hidden', !n || viewAlbum.classList.contains('hidden'));
  // A folder album mirrors that folder: photos come from it, so no manual import here.
  importLabel.classList.toggle('hidden', !!al.folder);
  dropHint.classList.toggle('hidden', !!al.folder || selecting);
}

// Coalesce many relayouts (e.g. one per imported photo) into one per frame.
function scheduleGallery() {
  if (galleryRaf) return;
  galleryRaf = requestAnimationFrame(() => { galleryRaf = 0; layoutGallery(); });
}

// Aspect of what the thumbnail shows: the cropped + rotated result once edited.
function shownAspect(ph) {
  if (!ph.width || !ph.height) return 1;
  const o = outputSize(ph.width, ph.height, ph.params.crop, rotSteps(ph.params.rotation), 4096);
  return o.w / o.h;
}

// Justified rows: each full row spans the grid width exactly; photos keep their ratio.
function layoutGallery() {
  const al = state.albums.get(state.activeAlbum);
  if (!al) return;
  const photos = al.photoIds.map((id) => state.photos.get(id)).filter(Boolean);
  const width = photoGrid.clientWidth;
  if (!width) return;
  const targetH = width < 600 ? 140 : 240;
  const rows = justifyRows(photos.map(shownAspect), width, targetH, GALLERY_GAP);
  const frag = document.createDocumentFragment();
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'photo-row';
    row.style.height = `${r.height}px`;
    for (const ph of photos.slice(r.start, r.end)) row.appendChild(photoCard(ph, r.height));
    frag.appendChild(row);
  }
  photoGrid.replaceChildren(frag);
}

function photoCard(ph, h) {
  const card = document.createElement('div');
  card.className = 'photo-card' + (isEdited(ph) ? ' edited' : '') + (selected.has(ph.id) ? ' selected' : '');
  card.style.width = `${shownAspect(ph) * h}px`;
  card.title = ph.name;
  card.dataset.id = ph.id;
  card.innerHTML = '<img loading="lazy" decoding="async" alt=""/><span class="nm"></span>'
    + '<div class="card-actions"><button class="dup" type="button" aria-label="Duplicate photo" title="Duplicate">⧉</button>'
    + '<button class="del" type="button" aria-label="Delete photo" title="Delete">✕</button></div>';
  card.querySelector('img').src = ph.thumbUrl || ph.url;
  card.querySelector('.nm').textContent = ph.name;
  card.querySelector('.dup').addEventListener('click', (e) => { e.stopPropagation(); doDuplicate(ph.id); });
  card.querySelector('.del').addEventListener('click', (e) => { e.stopPropagation(); doDelete([ph.id]); });
  card.addEventListener('click', () => {
    if (!selecting) { openEditor(ph.id); return; }
    if (selected.has(ph.id)) selected.delete(ph.id); else selected.add(ph.id);
    card.classList.toggle('selected', selected.has(ph.id));
    syncSelectUI();
  });
  return card;
}

// --- selection ---
function setSelecting(on) {
  selecting = on;
  selected.clear();
  syncSelectUI();
  layoutGallery();
}

function syncSelectUI() {
  const al = state.albums.get(state.activeAlbum);
  for (const id of [...selected]) if (!state.photos.has(id)) selected.delete(id);
  const n = selected.size, total = al ? al.photoIds.length : 0;
  photoGrid.classList.toggle('selecting', selecting);
  selectBar.classList.toggle('hidden', !selecting);
  dropHint.classList.toggle('hidden', selecting || !!(al && al.folder));
  btnSelect.classList.toggle('active', selecting);
  btnSelect.textContent = selecting ? 'selecting' : 'select';
  selCount.textContent = n ? `${n} of ${total} selected` : 'tap photos to select';
  btnSelAll.textContent = n && n === total ? 'select none' : 'select all';
  btnSelExport.disabled = !n || exporting || saving;
  btnSelDelete.disabled = !n;
  btnSelExport.textContent = n ? `export ${n}` : 'export selected';
}

// Delete with undo instead of a blocking confirm.
function doDelete(ids) {
  const removed = ids.map((id) => deletePhoto(id)).filter(Boolean).reverse();
  if (!removed.length) return;
  selected.clear();
  renderAlbums();
  renderAlbumDetail();
  const n = removed.length;
  toast(`Deleted ${n === 1 ? removed[0].photo.name : n + ' photos'}`, {
    ms: 6000,
    action: {
      label: 'undo',
      run: () => { removed.reverse().forEach(restorePhoto); renderAlbums(); renderAlbumDetail(); toast(`Restored ${n === 1 ? removed[0].photo.name : n + ' photos'}`); },
      expire: () => { for (const r of removed) if (!state.photos.has(r.photo.id) && !isUrlInUse(r.photo.url)) revokePhoto(r.photo); },
    },
  });
}

function doDuplicate(pid) {
  const copy = duplicatePhoto(pid);
  if (!copy) return;
  toast(`Duplicated as ${copy.name}`);
  renderAlbums();
  if (viewEditor.classList.contains('hidden')) renderAlbumDetail();
  else renderFilmstrip();
}

async function doImport(fileList, handleOf) {
  const albumId = state.activeAlbum;
  if (!albumId) { toast('Create an album first'); return; }
  const total = [...fileList].filter(looksLikeImage).length;
  importing = { albumId, done: 0, total };
  toast(`importing 0/${total}…`, { busy: true });
  renderAlbumMeta();
  try {
    const { added, skipped } = await importFiles(albumId, fileList, ({ done, name }) => {
      importing.done = done;
      toast(`importing ${done}/${total} · ${name}`, { busy: true });
      if (state.activeAlbum !== albumId) return;
      renderAlbumMeta();
      if (viewEditor.classList.contains('hidden')) scheduleGallery();
      else renderFilmstrip();
    }, handleOf);
    importing = null;
    const msg = `Added ${added.length} photo${added.length === 1 ? '' : 's'}`;
    if (skipped.length) {
      // Group reasons: "skipped 6 (4 HEIC not supported…, 2 not an image)"
      const byReason = new Map();
      for (const s of skipped) byReason.set(s.reason, (byReason.get(s.reason) || 0) + 1);
      const why = [...byReason].map(([r, n]) => `${n} ${r}`).join(', ');
      console.warn('nomi: skipped files', skipped);
      toast(`${msg} · skipped ${skipped.length} (${why})`, { ms: 10000 });
    } else toast(msg);
  } catch (err) {
    importing = null;
    toast(err && err.message ? err.message : 'Import failed');
  }
  renderAlbums();
  if (state.activeAlbum === albumId) {
    renderAlbumMeta();
    if (viewEditor.classList.contains('hidden')) layoutGallery();
    else renderFilmstrip();
  }
}

// --- editor ---
// Layout (untransformed) box of the canvas, so the crop-view zoom transform doesn't feed back.
function syncCropFrame() {
  const box = {
    left: `${glCanvas.offsetLeft}px`, top: `${glCanvas.offsetTop}px`,
    width: `${glCanvas.offsetWidth}px`, height: `${glCanvas.offsetHeight}px`,
  };
  Object.assign(cropLayer.style, box);
  Object.assign(textLayer.style, box);
}

// What the text gizmo needs to map between the on-screen frame and source space.
function textFrame() {
  const ph = curPhoto();
  if (!ph || !engine) return null;
  const { w: imgW, h: imgH } = engine.getImageSize();
  if (!imgW || !imgH) return null;
  const p = cropMode ? { ...ph.params, crop: FULL } : ph.params;
  return { map: frameMap(p, glCanvas.width, glCanvas.height), imgW, imgH };
}

function stageInner() {
  const cs = getComputedStyle(stageWrap);
  return {
    w: stageWrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
    h: stageWrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom),
  };
}

// --- crop view: zoom so the crop fills the stage, like iOS does after you let go ---
function applyCropView(animate) {
  const ph = curPhoto();
  if (!cropMode || !ph) { clearCropView(); return; }
  const d = sourceToDisplay(ph.params.crop, rotSteps(ph.params.rotation));
  const cw = glCanvas.offsetWidth, ch = glCanvas.offsetHeight;
  if (!cw || !ch) return;
  const { w, h } = stageInner();
  const s = Math.max(1, Math.min(w / (d.w * cw), h / (d.h * ch), 12));
  const ox = (d.x + d.w / 2 - 0.5) * cw, oy = (d.y + d.h / 2 - 0.5) * ch;
  const t = `translate(${-ox * s}px, ${-oy * s}px) scale(${s})`;
  stageWrap.classList.toggle('crop-anim', !!animate);
  glCanvas.style.transform = t;
  cropLayer.style.transform = t;
  cropLayer.style.setProperty('--inv', String(1 / s));
  stageWrap.classList.add('crop-settled');
}

function clearCropView() {
  clearTimeout(settleT);
  cropAdjusting = false;
  stageWrap.classList.remove('crop-anim', 'crop-settled');
  glCanvas.style.transform = '';
  cropLayer.style.transform = '';
  cropLayer.style.removeProperty('--inv');
}

function settleCropSoon(ms = 900) {
  clearTimeout(settleT);
  settleT = setTimeout(() => { if (!cropAdjusting) applyCropView(true); }, ms);
}

// --- undo / redo within one editing session ---
const snap = (p) => JSON.stringify(p);
function resetHistory(ph) {
  clearTimeout(commitT);
  history = [structuredClone(ph.params)];
  future = [];
  syncUndoUI();
}

// Called on every change; records one step once things settle (a whole drag = one step).
function noteChange() {
  clearTimeout(commitT);
  commitT = setTimeout(commitHistory, 350);
}

function commitHistory() {
  const ph = curPhoto();
  if (!ph || !history.length) return;
  if (pointerDown) { noteChange(); return; }
  if (snap(history[history.length - 1]) === snap(ph.params)) return;
  history.push(structuredClone(ph.params));
  if (history.length > 200) history.shift();
  future = [];
  syncUndoUI();
}

function syncUndoUI() {
  btnUndo.disabled = history.length < 2;
  btnRedo.disabled = !future.length;
}

function restoreParams(p) {
  const ph = curPhoto();
  if (!ph) return;
  // Keep the same params object: sliders, filters and crop hold references to it.
  for (const k of Object.keys(ph.params)) delete ph.params[k];
  Object.assign(ph.params, structuredClone(p));
  if (sliders) sliders.update();
  if (filterStrip) { filterStrip.update(); if (tab === 'filters') filterStrip.refresh(); }
  syncCropControls();
  if (cropApi) cropApi.layout();
  if (textApi) textApi.refresh();
  schedule();
  if (cropMode) settleCropSoon(0);
  syncUndoUI();
}

function undo() {
  clearTimeout(commitT);
  commitHistory();
  if (history.length < 2) return;
  future.push(history.pop());
  restoreParams(history[history.length - 1]);
}

function redo() {
  if (!future.length) return;
  const next = future.pop();
  history.push(next);
  restoreParams(next);
}

function containStage() {
  if (!engine) return;
  if (zoom) zoom.reset(); // the canvas is about to change size; start from fit
  const cs = getComputedStyle(stageWrap);
  const r = stageWrap.getBoundingClientRect();
  const w = r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const h = r.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  engine.layoutContain(w, h);
  syncCropFrame();
  if (cropApi) cropApi.layout();
  if (cropMode && !cropAdjusting) applyCropView(false);
}

// Rightmost column of the rendered photo, blended toward --bg so rail text stays legible.
function sampleEdge() {
  const gl = engine.gl;
  if (gl.isContextLost()) return;
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  if (w < 1 || h < 1) return;
  const n = Math.min(32, h), step = h / n;
  const px = new Uint8Array(4);
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < n; i++) {
    gl.readPixels(w - 1, Math.floor(i * step + step / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    r += px[0]; g += px[1]; b += px[2];
  }
  const mix = (v, bg) => Math.round((v / n) * 0.22 + bg * 0.78);
  document.documentElement.style.setProperty('--edge-soft', `rgb(${mix(r, BG[0])},${mix(g, BG[1])},${mix(b, BG[2])})`);
}

function schedule() {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; renderNow(); noteChange(); });
}

// Draw the current photo right now (same task), so buffer and layout never disagree on screen.
function renderNow() {
  const ph = curPhoto();
  if (!ph || !engine) return;
  // Crop mode shows the full rotated frame under the overlay; otherwise the cropped result.
  const p = cropMode ? { ...ph.params, crop: FULL } : ph.params;
  if (engine.fitOutput(p)) containStage();
  engine.render(p);
  engine.renderTexts(ph.params.texts, p);
  sampleEdge();
  syncCropFrame();
  if (cropApi) cropApi.layout();
  if (textApi && tab === 'text') textApi.layout();
}

async function openEditor(pid) {
  const seq = ++openSeq;
  const ph = state.photos.get(pid);
  if (!ph) return;
  if (!engine) engine = createEngine(glCanvas);
  if (!engine) { toast('WebGL2 is not available in this browser'); return; }
  if (!zoom) zoom = attachZoom({ wrap: stageWrap, canvas: glCanvas, enabled: () => tab === 'adjust' || tab === 'filters' });
  navTarget = pid;
  syncNavUI();
  // Decode first; until then the current photo stays on screen exactly as it is.
  const bmp = await createImageBitmap(ph.file, { imageOrientation: 'from-image' });
  if (seq !== openSeq) { bmp.close(); return; } // a newer photo was opened meanwhile (fast arrowing)
  // Everything below runs in one task, so the swap is a single paint.
  cancelAnimationFrame(raf); raf = 0;
  clearTimeout(commitT);
  state.activePhoto = pid;
  navTarget = null;
  snapshot = structuredClone(ph.params);
  edName.textContent = ph.name;
  engine.setImage(bmp);
  bmp.close();
  sliders = buildSliders(panelAdjust, ph.params, schedule);
  filterStrip = buildFilterStrip(panelFilters, { params: ph.params, onChange: schedule, renderPreview: renderFilterPreview });
  loadPreviewImage(ph.file).then(() => { if (curPhoto() === ph && filterStrip) filterStrip.refresh(); });
  if (cropApi) cropApi.destroy();
  cropApi = attachCrop({ layer: cropLayer, box: cropBox, wrap: cropLayer, params: ph.params, onChange: schedule, getImageSize: engine.getImageSize });
  if (textApi) textApi.destroy();
  textApi = attachText({ layer: textLayer, panel: panelText, params: ph.params, getFrame: textFrame, onChange: schedule });
  syncCropControls();
  resetHistory(ph);
  show('viewEditor');
  setTab('adjust');
  renderFilmstrip();
  syncNavUI();
  engine.fitOutput(ph.params);
  containStage();
  renderNow();
}

// Re-render the photo with its current params and use that as the grid/filmstrip thumbnail.
function refreshThumb(ph) {
  if (!engine || !ph) return;
  engine.fitOutput(ph.params);
  engine.render(ph.params);
  engine.renderTexts(ph.params.texts, ph.params);
  const t = thumbSize(glCanvas.width, glCanvas.height, 640);
  const c = document.createElement('canvas');
  c.width = t.w; c.height = t.h;
  c.getContext('2d').drawImage(glCanvas, 0, 0, t.w, t.h);
  ph.thumbUrl = c.toDataURL('image/jpeg', 0.8);
  // The render above used the visible canvas; put the on-screen frame back before the browser paints.
  if (!viewEditor.classList.contains('hidden') && curPhoto() === ph) renderNow();
}

function closeEditor() {
  if (zoom) zoom.reset();
  refreshThumb(curPhoto());
  if (cropApi) { cropApi.destroy(); cropApi = null; }
  if (textApi) { textApi.destroy(); textApi = null; }
  clearCropView();
  clearTimeout(commitT);
  history = []; future = []; // edits are final once you leave the editor
  cropMode = false;
  renderAlbums();
  renderAlbumDetail();
}

function syncCropControls() {
  const ph = curPhoto();
  if (!ph) return;
  inStraighten.value = String(ph.params.straighten || 0);
  vStraighten.textContent = `${ph.params.straighten || 0}°`;
  aspectRow.innerHTML = '';
  for (const a of ASPECTS) {
    const b = document.createElement('button');
    b.className = 'chip' + ((ph.params.aspect || 'free') === a.id ? ' active' : '');
    b.textContent = a.label;
    b.addEventListener('click', () => { cropApi.setAspect(a.id); syncCropControls(); settleCropSoon(250); });
    aspectRow.appendChild(b);
  }
}

function setTab(name) {
  tab = name;
  const crop = name === 'crop';
  cropMode = crop;
  for (const [t, panel, id] of [[tabAdjust, panelAdjust, 'adjust'], [tabFilters, panelFilters, 'filters'], [tabCrop, panelCrop, 'crop'], [tabText, panelText, 'text']]) {
    t.classList.toggle('active', id === name);
    t.setAttribute('aria-selected', String(id === name));
    panel.classList.toggle('hidden', id !== name);
  }
  cropLayer.classList.toggle('hidden', !crop);
  textLayer.classList.toggle('hidden', name !== 'text');
  if (name === 'text' && textApi) textApi.refresh();
  viewEditor.classList.toggle('cropping', crop);
  if (!crop) clearCropView();
  if (name === 'filters' && filterStrip) filterStrip.refresh();
  containStage();
  schedule();
}

// Filter previews: a second, tiny WebGL engine renders the current edit through each filter.
const PREVIEW_PX = 144;
async function loadPreviewImage(file) {
  previewReady = false;
  if (!previewEngine) previewEngine = createEngine(document.createElement('canvas'));
  if (!previewEngine) return;
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  previewEngine.setImage(bmp, 384);
  bmp.close();
  previewReady = true;
}

function renderFilterPreview(id, canvas) {
  const ph = curPhoto();
  if (!previewReady || !ph) return;
  const p = { ...ph.params, filter: id, filterAmount: 100 };
  previewEngine.fitOutput(p, 384);
  previewEngine.render(p);
  const src = previewEngine.gl.canvas;
  // Square cover crop, like the iOS filter strip.
  const side = Math.min(src.width, src.height);
  canvas.width = PREVIEW_PX; canvas.height = PREVIEW_PX;
  canvas.getContext('2d').drawImage(src, (src.width - side) / 2, (src.height - side) / 2, side, side, 0, 0, PREVIEW_PX, PREVIEW_PX);
}

function renderFilmstrip() {
  const al = state.albums.get(state.activeAlbum);
  filmstrip.innerHTML = '';
  if (!al) return;
  for (const pid of al.photoIds) {
    const p = state.photos.get(pid);
    if (!p) continue;
    const img = document.createElement('img');
    img.src = p.thumbUrl || p.url; img.alt = p.name;
    if (pid === state.activePhoto) img.classList.add('active');
    img.addEventListener('click', () => { if (pid !== state.activePhoto) switchPhoto(pid); });
    filmstrip.appendChild(img);
  }
  const active = filmstrip.querySelector('img.active');
  if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// Moving to another photo keeps the current edits (same as Done) and starts a fresh history.
function switchPhoto(pid) {
  clearTimeout(commitT);
  const cur = curPhoto();
  if (cur) refreshThumb(cur);
  openEditor(pid); // crop view / tab reset happen when the next photo is ready, in one paint
}

function neighbour(delta) {
  const al = state.albums.get(state.activeAlbum);
  if (!al) return null;
  const i = al.photoIds.indexOf(navTarget || state.activePhoto);
  return i < 0 ? null : al.photoIds[i + delta] || null;
}

function stepPhoto(delta) {
  const pid = neighbour(delta);
  if (pid) switchPhoto(pid);
}

function syncNavUI() {
  btnPrev.disabled = !neighbour(-1);
  btnNext.disabled = !neighbour(1);
}

async function doExport(ids) {
  const al = state.albums.get(state.activeAlbum);
  if (!al || exporting) return;
  const photos = (ids || al.photoIds).map((id) => state.photos.get(id)).filter(Boolean);
  if (!photos.length) return;
  const partial = photos.length < al.photoIds.length;
  exporting = true;
  syncSelectUI();
  const setLabel = busyButton(btnDownloadAlbum, `0/${photos.length}`);
  toast(`exporting 0/${photos.length}…`, { busy: true });
  try {
    const zipAlbum = partial ? { ...al, name: `${al.name} (${photos.length} of ${al.photoIds.length})` } : al;
    await exportAlbumZip(zipAlbum, photos, ({ done, total, name }) => {
      setLabel(`${done}/${total}`);
      toast(`exporting ${done}/${total} · ${name}`, { busy: true });
    });
    toast(`Saved ${photos.length} photo${photos.length === 1 ? '' : 's'} to ZIP`);
    if (partial) setSelecting(false);
  } catch (err) { toast(err && err.message ? err.message : 'Export failed'); }
  exporting = false;
  setLabel.done();
  syncSelectUI();
}

// --- export menu: "save to folder" or "download zip" for the album or a selection ---
function exportScope(ids) {
  const al = state.albums.get(state.activeAlbum);
  return al ? (ids || al.photoIds).map((id) => state.photos.get(id)).filter(Boolean) : [];
}

// Photos that "save to folder" would write: edited folder photos, plus copies (new files).
const toSave = (photos) => photos.filter((p) => p.dir && (isEdited(p) || !p.handle));

function folderOption(photos) {
  if (!supportsFolders()) return { ok: false, hint: 'needs Chrome or Edge' };
  if (!photos.some((p) => p.dir)) return { ok: false, hint: 'open photos with “open folder” first' };
  const list = toSave(photos);
  if (!list.length) return { ok: false, hint: 'nothing edited yet' };
  return { ok: true, hint: `${saveSummary(list)} · originals kept in ${BACKUP_DIR}` };
}

// "overwrite 3 files · create 1" — copies become new files, edited originals are replaced.
function saveSummary(list) {
  const over = list.filter((p) => p.handle).length, make = list.length - over;
  const parts = [];
  if (over) parts.push(`overwrite ${over} file${over === 1 ? '' : 's'}`);
  if (make) parts.push(`create ${make} new file${make === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

function openExportMenu(ids, anchor) {
  if (exporting || saving) return;
  const photos = exportScope(ids);
  if (!photos.length) return;
  menuIds = ids;
  const folder = folderOption(photos);
  exportTitle.textContent = `export ${photos.length} photo${photos.length === 1 ? '' : 's'}`;
  const [fItem, zItem] = exportMenu.querySelectorAll('.menu-item');
  fItem.setAttribute('aria-disabled', String(!folder.ok));
  fItem.querySelector('.mi-hint').textContent = folder.hint;
  exportMenu.classList.remove('hidden');
  const r = anchor.getBoundingClientRect(), m = exportMenu.getBoundingClientRect();
  exportMenu.style.top = `${Math.min(r.bottom + 4, innerHeight - m.height - 8)}px`;
  exportMenu.style.left = `${Math.max(8, Math.min(r.right - m.width, innerWidth - m.width - 8))}px`;
  setMenuActive(lastExport === 'folder' && folder.ok ? fItem : zItem);
}

function closeExportMenu() { exportMenu.classList.add('hidden'); }

function setMenuActive(item) {
  for (const it of exportMenu.querySelectorAll('.menu-item')) it.classList.toggle('active', it === item);
  item.focus({ preventScroll: true });
}

function chooseExport(item) {
  if (!item || item.getAttribute('aria-disabled') === 'true') return;
  const ids = menuIds;
  lastExport = item.dataset.choice;
  closeExportMenu();
  if (lastExport === 'zip') doExport(ids);
  else confirmSaveToFolder(ids);
}

// Overwriting originals is the one destructive action, so it asks once, inline.
function confirmSaveToFolder(ids) {
  const photos = toSave(exportScope(ids));
  const folders = [...new Set(photos.map((p) => p.dir.name))].join(', ');
  toast(`${saveSummary(photos)} in “${folders}” · originals kept in ${BACKUP_DIR}`, {
    ms: 12000,
    action: { label: 'confirm', run: () => doSaveToFolder(ids) },
  });
}

async function doSaveToFolder(ids) {
  // Copies (no handle yet) first: they may read the same original file that is about to be replaced.
  const photos = toSave(exportScope(ids)).sort((a, b) => (a.handle ? 1 : 0) - (b.handle ? 1 : 0));
  if (!photos.length || saving) return;
  for (const dir of new Set(photos.map((p) => p.dir))) {
    if (!(await ensurePermission(dir))) { toast(`No permission to write to “${dir.name}”`); return; }
  }
  saving = true;
  syncSelectUI();
  const setLabel = busyButton(btnDownloadAlbum, `0/${photos.length}`);
  const skipped = [];
  let saved = 0, created = 0;
  for (const [i, ph] of photos.entries()) {
    toast(`saving ${i + 1}/${photos.length} · ${ph.name}`, { busy: true });
    setLabel(`${i + 1}/${photos.length}`);
    try {
      const oldFile = ph.file;
      // Anything else still reading this file (e.g. an unsaved copy) gets an in-memory snapshot first.
      const sharing = [...state.photos.values()].filter((p) => p !== ph && p.file === oldFile);
      if (sharing.length && ph.handle) {
        const snapshotFile = new File([await oldFile.arrayBuffer()], oldFile.name, { type: oldFile.type, lastModified: oldFile.lastModified });
        const url = URL.createObjectURL(snapshotFile);
        for (const p of sharing) { p.file = snapshotFile; p.url = url; }
      }
      const r = await saveInPlace(ph);
      if (r.status === 'skipped') { skipped.push({ name: ph.name, reason: r.reason }); continue; }
      bakeSaved(ph, r);
      if (r.status === 'created') created++; else saved++;
    } catch (err) {
      skipped.push({ name: ph.name, reason: (err && err.message) || 'write failed' });
    }
  }
  saving = false;
  setLabel.done();
  renderAlbums();
  renderAlbumDetail();
  if (selecting && ids) setSelecting(false);
  let msg = `saved ${saved} file${saved === 1 ? '' : 's'}` + (created ? ` · created ${created}` : '');
  if (skipped.length) {
    const why = [...skipped.reduce((m, s) => m.set(s.reason, (m.get(s.reason) || 0) + 1), new Map())].map(([r, n]) => `${n} ${r}`).join(', ');
    console.warn('nomi: not saved', skipped);
    msg += ` · skipped ${skipped.length} (${why})`;
  }
  toast(msg, { ms: 8000 });
}

// The file on disk now contains the edit: point the photo at it and start from neutral settings.
function bakeSaved(ph, { file, handle, status }) {
  const o = outputSize(ph.width, ph.height, ph.params.crop, rotSteps(ph.params.rotation), Infinity);
  const oldUrl = ph.url;
  ph.file = file;
  ph.handle = handle;
  ph.name = handle.name;
  if (status === 'created') ph.createdHere = true; // written by nomi: no original to back up later
  ph.url = URL.createObjectURL(file);
  ph.width = o.w; ph.height = o.h;
  for (const k of Object.keys(ph.params)) delete ph.params[k];
  Object.assign(ph.params, defaultParams());
  if (!isUrlInUse(oldUrl)) URL.revokeObjectURL(oldUrl);
}

// Every folder becomes its own album, named after the folder.
async function doOpenFolder() {
  let res;
  try { res = await openFolder(); } catch (err) {
    if (err && err.name !== 'AbortError') toast(err.message || 'Could not open folder');
    return;
  }
  if (!res.entries.length) { toast(`No images in “${res.name}”`); return; }
  const id = uid('al');
  state.albums.set(id, { id, name: res.name.slice(0, 60), folder: res.name, photoIds: [], createdAt: Date.now() });
  renderAlbums();
  openAlbum(id);
  const byFile = new Map(res.entries.map((e) => [e.file, { handle: e.handle, dir: res.dir }]));
  await doImport(res.entries.map((e) => e.file), (file) => byFile.get(file));
}

// --- wiring ---
btnNewAlbum.addEventListener('click', () => {
  // Create immediately and focus the inline title for naming (no blocking prompt()).
  const id = uid('al');
  state.albums.set(id, { id, name: `Album ${state.albums.size + 1}`, photoIds: [], createdAt: Date.now() });
  renderAlbums(); openAlbum(id);
  albumName.focus();
  albumName.select();
});
btnDemo.addEventListener('click', () => toast('New album → Import photos → click a photo → Done → Download ZIP'));
btnBackAlbums.addEventListener('click', () => { if (selecting) setSelecting(false); state.activeAlbum = null; renderAlbums(); show('viewAlbums'); });
albumName.addEventListener('input', () => {
  const al = state.albums.get(state.activeAlbum);
  if (!al) return;
  al.name = (albumName.value.trim() || 'Untitled').slice(0, 60);
  crumb.textContent = `albums / ${al.name}`;
});
albumName.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') albumName.blur(); });
fileInput.addEventListener('change', () => { if (fileInput.files.length) doImport(fileInput.files); fileInput.value = ''; });
dropHint.addEventListener('click', () => fileInput.click());
dropHint.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
window.addEventListener('resize', () => { if (!viewEditor.classList.contains('hidden')) containStage(); });
window.addEventListener('dragover', (e) => e.preventDefault());
// Dropped folders arrive as a single entry; walk them so every photo inside is imported.
async function filesFromDrop(dt) {
  const entries = [...(dt.items || [])].map((it) => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean);
  if (!entries.length) return [...(dt.files || [])];
  const out = [];
  const walk = async (entry) => {
    if (entry.isFile) { out.push(await new Promise((res, rej) => entry.file(res, rej))); return; }
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise((res, rej) => reader.readEntries(res, rej)); // returns ≤100 per call
      if (!batch.length) break;
      for (const child of batch) if (!child.name.startsWith('.')) await walk(child);
    }
  };
  for (const entry of entries) await walk(entry);
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  if (!e.dataTransfer) return;
  if (!state.activeAlbum) { toast('Open an album to import'); return; }
  const al = state.albums.get(state.activeAlbum);
  if (al && al.folder) { toast(`“${al.folder}” mirrors its folder — add photos to the folder, or use a new album`); return; }
  const files = await filesFromDrop(e.dataTransfer);
  if (files.length) doImport(files);
});
tabAdjust.addEventListener('click', () => setTab('adjust'));
tabFilters.addEventListener('click', () => setTab('filters'));
tabCrop.addEventListener('click', () => setTab('crop'));
tabText.addEventListener('click', () => setTab('text'));
setFontListener(() => schedule());
btnRot.addEventListener('click', () => {
  const ph = curPhoto(); if (!ph) return;
  // Crop lives in source space, so it rotates with the photo.
  ph.params.rotation = ((ph.params.rotation || 0) + 90) % 360;
  schedule();
  settleCropSoon(120);
});
inStraighten.addEventListener('input', () => {
  const ph = curPhoto(); if (!ph) return;
  ph.params.straighten = parseFloat(inStraighten.value) || 0;
  vStraighten.textContent = `${ph.params.straighten}°`;
  schedule();
});
btnReset.addEventListener('click', () => {
  const ph = curPhoto(); if (!ph) return;
  Object.assign(ph.params, defaultParams());
  if (sliders) sliders.update();
  if (filterStrip) { filterStrip.update(); filterStrip.refresh(); }
  syncCropControls();
  if (textApi) textApi.refresh();
  schedule();
  if (cropMode) settleCropSoon(0);
  toast('Reset');
});
btnBackAlbum.addEventListener('click', () => {
  const ph = curPhoto();
  if (ph && snapshot) Object.assign(ph.params, snapshot);
  closeEditor();
});
btnDone.addEventListener('click', closeEditor);
btnUndo.addEventListener('click', undo);
btnPrev.addEventListener('click', () => stepPhoto(-1));
btnNext.addEventListener('click', () => stepPhoto(1));
document.addEventListener('keydown', (e) => {
  if (viewEditor.classList.contains('hidden') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const el = document.activeElement;
  // A slider reached by keyboard keeps its arrows; one that was just clicked doesn't.
  if (el && el.matches('input[type=range]') && el.matches(':focus-visible')) return;
  if (el && el.matches('input:not([type=range]), textarea')) return;
  e.preventDefault();
  stepPhoto(e.key === 'ArrowLeft' ? -1 : 1);
});
// Clicked sliders give focus back so ←/→ go to the next photo.
panelAdjust.addEventListener('pointerup', (e) => { if (e.target.matches('input[type=range]')) e.target.blur(); });
panelFilters.addEventListener('pointerup', (e) => { if (e.target.matches('input[type=range]')) e.target.blur(); });
panelText.addEventListener('pointerup', (e) => { if (e.target.matches('input[type=range]')) e.target.blur(); });
// ⌫ / Delete removes the selected text layer while the text tool is open (undo brings it back).
document.addEventListener('keydown', (e) => {
  if (viewEditor.classList.contains('hidden') || tab !== 'text' || !textApi) return;
  if (e.key !== 'Backspace' && e.key !== 'Delete') return;
  const el = document.activeElement;
  if (el && el.matches('input:not([type=range]), textarea, [contenteditable]')) return;
  if (textApi.removeSelected()) e.preventDefault();
});
inStraighten.addEventListener('pointerup', () => inStraighten.blur());
btnRedo.addEventListener('click', redo);
document.addEventListener('keydown', (e) => {
  if (viewEditor.classList.contains('hidden') || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
  e.preventDefault();
  if (e.shiftKey) redo(); else undo();
});
// Gesture tracking: history waits for the pointer to lift; the crop view un-settles while you drag.
document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
window.addEventListener('pointerup', () => {
  pointerDown = false;
  if (cropAdjusting) { cropAdjusting = false; settleCropSoon(); }
});
window.addEventListener('pointercancel', () => { pointerDown = false; if (cropAdjusting) { cropAdjusting = false; settleCropSoon(); } });
cropLayer.addEventListener('pointerdown', () => {
  cropAdjusting = true;
  clearTimeout(settleT);
  stageWrap.classList.remove('crop-anim', 'crop-settled');
}, true);
btnDownloadAlbum.addEventListener('click', () => openExportMenu(null, btnDownloadAlbum));
btnOpenFolder.addEventListener('click', () => doOpenFolder());
if (supportsFolders()) btnOpenFolder.classList.remove('hidden');
exportMenu.addEventListener('click', (e) => chooseExport(e.target.closest('.menu-item')));
exportMenu.addEventListener('pointermove', (e) => {
  const it = e.target.closest('.menu-item');
  if (it && !it.classList.contains('active')) setMenuActive(it);
});
exportMenu.addEventListener('keydown', (e) => {
  const items = [...exportMenu.querySelectorAll('.menu-item')];
  const i = items.findIndex((it) => it.classList.contains('active'));
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    setMenuActive(items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]);
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    chooseExport(items[i]);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeExportMenu();
  }
});
document.addEventListener('pointerdown', (e) => {
  if (!exportMenu.classList.contains('hidden') && !exportMenu.contains(e.target) && e.target !== btnDownloadAlbum && e.target !== btnSelExport) closeExportMenu();
});
window.addEventListener('resize', closeExportMenu);
btnSelect.addEventListener('click', () => setSelecting(!selecting));
btnSelDone.addEventListener('click', () => setSelecting(false));
btnSelAll.addEventListener('click', () => {
  const al = state.albums.get(state.activeAlbum);
  if (!al) return;
  if (selected.size === al.photoIds.length) selected.clear(); else al.photoIds.forEach((id) => selected.add(id));
  syncSelectUI();
  layoutGallery();
});
btnSelExport.addEventListener('click', () => openExportMenu([...selected], btnSelExport));
btnSelDelete.addEventListener('click', () => doDelete([...selected]));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && selecting) setSelecting(false); });
btnDuplicate.addEventListener('click', () => { if (state.activePhoto) doDuplicate(state.activePhoto); });
new ResizeObserver(() => { if (!viewAlbum.classList.contains('hidden')) layoutGallery(); }).observe(photoGrid);

renderAlbums();
show('viewAlbums');
