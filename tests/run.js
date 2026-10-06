const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let pass = 0, fail = 0;
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra ? ' — ' + extra : ''}`); }
}

function crc32Bytes(bytes, table) {
  let c = 0xFFFFFFFF;
  for (const b of bytes) c = table[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

(async () => {
  const storeUrl = pathToFileURL(path.join(__dirname, '..', 'src', 'store.js')).href;
  const store = await import(storeUrl);
  const { defaultParams, clampCrop, isEdited } = store;

  // 1. defaultParams
  const d = defaultParams();
  const keys = ['exposure','brilliance','highlights','shadows','contrast','brightness','blackpoint','saturation','vibrance','warmth','tint'];
  ok(keys.length === 11 && keys.every(k => d[k] === 0), 'defaultParams 11 adjustments at 0', JSON.stringify(d));
  ok(d.crop && d.crop.x === 0 && d.crop.y === 0 && d.crop.w === 1 && d.crop.h === 1, 'defaultParams crop {0,0,1,1}');
  ok(d.rotation === 0 && d.straighten === 0, 'defaultParams rotation/straighten 0');

  // 2. clampCrop
  const c = clampCrop({ x: -0.1, y: 0.9, w: 2, h: 0.01 });
  const inRange = [c.x, c.y, c.w, c.h].every(v => v >= 0 && v <= 1);
  const fits = c.x + c.w <= 1 + 1e-9 && c.y + c.h <= 1 + 1e-9;
  const mins = c.w >= 0.05 - 1e-9 && c.h >= 0.05 - 1e-9;
  ok(inRange && fits && mins, 'clampCrop clamps to [0..1], min 0.05, fits', JSON.stringify(c));
  ok(c.x === 0 && c.y === 0.9 && c.w === 1 && Math.abs(c.h - 0.05) < 1e-9, 'clampCrop exact {0,0.9,1,0.05}', JSON.stringify(c));

  // 3. isEdited
  ok(isEdited({ params: defaultParams() }) === false, 'isEdited false on defaults');
  const tweaked = defaultParams(); tweaked.exposure = 0.1;
  ok(isEdited({ params: tweaked }) === true, 'isEdited true after exposure tweak');
  const cropTweak = defaultParams(); cropTweak.crop = { x: 0, y: 0, w: 0.5, h: 0.5 };
  ok(isEdited({ params: cropTweak }) === true, 'isEdited true after crop tweak');

  // 4a. pure-JS crc32 known vector (proves algorithm expectation)
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let v = n; for (let k = 0; k < 8; k++) v = (v & 1) ? 0xEDB88320 ^ (v >>> 1) : v >>> 1; table[n] = v >>> 0; }
  const vec = crc32Bytes(Buffer.from('123456789', 'utf8'), table);
  ok(vec === 0xCBF43926, 'crc32("123456789") == 0xCBF43926', 'got 0x' + vec.toString(16));

  // 4b. exporter.js text contracts (exporter uses DOM, so assert source shape)
  const expPath = path.join(__dirname, '..', 'src', 'exporter.js');
  let src = '';
  try { src = fs.readFileSync(expPath, 'utf8'); } catch (e) { src = ''; }
  ok(src.length > 0, 'exporter.js exists', expPath);
  ok(src.includes('STORE'), "exporter contains 'STORE'");
  ok(/method|compression/i.test(src) && src.includes('0'), 'exporter method 0 (STORE)');
  const hasCD = src.includes('PK\x01\x02') || src.includes('PK\\x01\\x02') || /02014b50/i.test(src);
  ok(hasCD, "exporter central directory 'PK\\x01\\x02'");
  const hasEOCD = src.includes('PK\x05\x06') || src.includes('PK\\x05\\x06') || /06054b50/i.test(src);
  ok(hasEOCD, "exporter EOCD 'PK\\x05\\x06'");
  ok(src.includes('1.0'), 'exporter quality 1.0');
  ok(src.includes('-edited'), "exporter '-edited' suffix");
  ok(src.includes('createImageBitmap'), "exporter 'createImageBitmap'");
  ok(src.includes('from-image'), "exporter 'from-image'");
  ok(/EDB88320/i.test(src), "exporter table CRC '0xEDB88320'");

  // 5. cropmath.js
  const cm = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'editor', 'cropmath.js')).href);
  const E = 1e-9;
  const near = (a, b, e = E) => Math.abs(a - b) <= e;
  const rectNear = (a, b, e = E) => near(a.x, b.x, e) && near(a.y, b.y, e) && near(a.w, b.w, e) && near(a.h, b.h, e);
  const inside = (r) => r.x >= -E && r.y >= -E && r.x + r.w <= 1 + E && r.y + r.h <= 1 + E;
  const J = JSON.stringify;

  const cl = cm.clamp01Rect({ x: -0.3, y: 0.99, w: 0.01, h: 3 });
  ok(inside(cl) && cl.w >= 0.05 - E && cl.h >= 0.05 - E && near(cl.x, 0) && near(cl.w, 0.05) && near(cl.h, 1) && near(cl.y, 0),
    'cropmath clamp01Rect bounds + min', J(cl));
  const cl2 = cm.clamp01Rect({ x: 0.9, y: 0.9, w: 0.5, h: 0.02 });
  ok(inside(cl2) && near(cl2.w, 0.5) && near(cl2.x, 0.5) && near(cl2.h, 0.05) && near(cl2.y, 0.9), 'cropmath clamp01Rect shifts to fit', J(cl2));
  ok(cm.rotSteps(0) === 0 && cm.rotSteps(90) === 1 && cm.rotSteps(180) === 2 && cm.rotSteps(270) === 3 && cm.rotSteps(360) === 0 && cm.rotSteps(-90) === 3,
    'cropmath rotSteps');

  // shader rotUV reference (display point -> source point)
  const rotUV = (x, y, s) => s === 1 ? [1 - y, x] : s === 2 ? [1 - x, 1 - y] : s === 3 ? [y, 1 - x] : [x, y];
  const rects = [{ x: 0, y: 0, w: 1, h: 1 }, { x: 0.1, y: 0.2, w: 0.3, h: 0.5 }, { x: 0.6, y: 0.05, w: 0.35, h: 0.9 }, { x: 0, y: 0.5, w: 0.25, h: 0.5 }];
  let rtOk = true, shaderOk = true, rtMsg = '';
  for (let s = 0; s < 4; s++) for (const r of rects) {
    const src = cm.displayToSource(r, s);
    const back = cm.sourceToDisplay(src, s);
    if (!rectNear(back, r)) { rtOk = false; rtMsg = `s=${s} ${J(r)} -> ${J(back)}`; }
    const back2 = cm.displayToSource(cm.sourceToDisplay(r, s), s);
    if (!rectNear(back2, r)) { rtOk = false; rtMsg = `inv s=${s} ${J(r)}`; }
    // Shader consistency: cropped output t -> src.xy + rotUV(t)*src.wh must equal rotUV(display point r.xy + t*r.wh)
    for (const [tx, ty] of [[0, 0], [1, 0], [0, 1], [0.3, 0.7], [1, 1]]) {
      const [ux, uy] = rotUV(tx, ty, s);
      const a = [src.x + ux * src.w, src.y + uy * src.h];
      const b = rotUV(r.x + tx * r.w, r.y + ty * r.h, s);
      if (!near(a[0], b[0]) || !near(a[1], b[1])) shaderOk = false;
    }
  }
  ok(rtOk, 'cropmath display<->source round-trip, 4 steps', rtMsg);
  ok(shaderOk, 'cropmath displayToSource consistent with shader crop+rotUV');
  const k0 = cm.displayToSource({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, 0);
  ok(rectNear(k0, { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }), 'cropmath steps=0 identity', J(k0));
  const k1 = cm.displayToSource({ x: 0, y: 0, w: 0.5, h: 1 }, 1);
  ok(rectNear(k1, { x: 0, y: 0, w: 1, h: 0.5 }), 'cropmath steps=1 left half -> source top half', J(k1));
  const k2 = cm.displayToSource({ x: 0, y: 0, w: 0.5, h: 0.25 }, 2);
  ok(rectNear(k2, { x: 0.5, y: 0.75, w: 0.5, h: 0.25 }), 'cropmath steps=2 top-left -> source bottom-right', J(k2));
  const k3 = cm.displayToSource({ x: 0, y: 0, w: 0.5, h: 1 }, 3);
  ok(rectNear(k3, { x: 0, y: 0.5, w: 1, h: 0.5 }), 'cropmath steps=3 left half -> source bottom half', J(k3));
  ok(near(cm.displayAspect(4000, 3000, 0), 4 / 3) && near(cm.displayAspect(4000, 3000, 1), 3 / 4), 'cropmath displayAspect swaps on odd steps');

  const ca = cm.centeredAspectRect(16 / 9, 4 / 3);
  ok(near(ca.w * (4 / 3) / ca.h, 16 / 9) && near(ca.x + ca.w / 2, 0.5) && near(ca.y + ca.h / 2, 0.5) && near(ca.w, 1) && near(ca.x, 0),
    'cropmath centeredAspectRect 16:9 on 4:3', J(ca));
  const ca2 = cm.centeredAspectRect(1, 1.5);
  ok(near(ca2.w * 1.5 / ca2.h, 1) && near(ca2.h, 1) && near(ca2.x + ca2.w / 2, 0.5), 'cropmath centeredAspectRect square on 3:2', J(ca2));

  const base = cm.centeredAspectRect(1, 1.5);
  let lockOk = true, lockMsg = '';
  for (const corner of ['tl', 'tr', 'bl', 'br']) for (const [dx, dy] of [[5, 3], [-5, -3], [0.9, -0.2], [-2, 0.1], [0.01, 4]]) {
    const r = cm.resizeFromCorner(base, corner, dx, dy, 1, 1.5);
    if (!(near(r.w * 1.5 / r.h, 1, 1e-9) && inside(r) && r.w >= 0.05 - E && r.h >= 0.05 - E)) { lockOk = false; lockMsg = `${corner} ${dx},${dy} ${J(r)}`; }
  }
  ok(lockOk, 'cropmath resizeFromCorner lock 1 @1.5 keeps ratio, inside, >= min', lockMsg);
  const s0 = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };
  const fr = cm.resizeFromCorner(s0, 'br', -2, -2, 0, 1.5);
  ok(near(fr.x, 0.2) && near(fr.y, 0.2) && near(fr.w, 0.05) && near(fr.h, 0.05), 'cropmath free drag past anchor stops at min', J(fr));
  const fr2 = cm.resizeFromCorner(s0, 'tl', 5, 5, 0, 1.5);
  ok(near(fr2.x + fr2.w, 0.6) && near(fr2.y + fr2.h, 0.6) && near(fr2.w, 0.05), 'cropmath free tl past anchor keeps anchor', J(fr2));
  const fr3 = cm.resizeFromCorner(s0, 'tr', 3, -3, 0, 1.5);
  ok(near(fr3.x, 0.2) && near(fr3.w, 0.8) && near(fr3.y, 0) && near(fr3.h, 0.6), 'cropmath free big drag clamps to bounds', J(fr3));

  // resizeFromEdge
  const eb = { x: 0.2, y: 0.3, w: 0.4, h: 0.3 };
  const e1 = cm.resizeFromEdge(eb, 't', 0, -0.1, 0, 1.5);
  ok(near(e1.y, 0.2) && near(e1.h, 0.4) && near(e1.x, 0.2) && near(e1.w, 0.4), 'cropmath edge t free changes only top', J(e1));
  const e2 = cm.resizeFromEdge(eb, 'b', 0.3, 0.1, 0, 1.5);
  ok(near(e2.y, 0.3) && near(e2.h, 0.4) && near(e2.x, 0.2) && near(e2.w, 0.4), 'cropmath edge b free changes only bottom (ignores dx)', J(e2));
  const e3 = cm.resizeFromEdge(eb, 'l', -0.1, 0.3, 0, 1.5);
  ok(near(e3.x, 0.1) && near(e3.w, 0.5) && near(e3.y, 0.3) && near(e3.h, 0.3), 'cropmath edge l free changes only left', J(e3));
  const e4 = cm.resizeFromEdge(eb, 'r', 0.1, 0.3, 0, 1.5);
  ok(near(e4.x, 0.2) && near(e4.w, 0.5) && near(e4.y, 0.3) && near(e4.h, 0.3), 'cropmath edge r free changes only right', J(e4));
  const e5 = cm.resizeFromEdge(eb, 't', 0, -5, 0, 1.5), e6 = cm.resizeFromEdge(eb, 'b', 0, 5, 0, 1.5);
  const e7 = cm.resizeFromEdge(eb, 'l', -5, 0, 0, 1.5), e8 = cm.resizeFromEdge(eb, 'r', 5, 0, 0, 1.5);
  ok(near(e5.y, 0) && near(e5.h, 0.6) && near(e6.y, 0.3) && near(e6.h, 0.7) && near(e7.x, 0) && near(e7.w, 0.6) && near(e8.x, 0.2) && near(e8.w, 0.8),
    'cropmath edge free clamps at image bounds', J([e5, e6, e7, e8]));
  const e9 = cm.resizeFromEdge(eb, 't', 0, 5, 0, 1.5), e10 = cm.resizeFromEdge(eb, 'r', -5, 0, 0, 1.5);
  ok(near(e9.h, 0.05) && near(e9.y, 0.55) && near(e10.w, 0.05) && near(e10.x, 0.2), 'cropmath edge free stops at min size keeping the anchor', J([e9, e10]));
  let edgeOk = true, edgeMsg = '';
  for (const [ratio, dA] of [[1, 1.5], [16 / 9, 1.5], [1.5, 1.5], [1, 0.75]]) {
    const k = ratio / dA;
    const sb = cm.centeredAspectRect(ratio, dA);
    const sm = { x: 0.3, y: 0.3, w: 0.3 * 1, h: 0.3 / k }; // off-centre box with the lock's ratio
    for (const st of [sb, sm]) for (const edge of ['t', 'r', 'b', 'l']) for (const [dx, dy] of [[0.1, 0.1], [-0.1, -0.1], [5, 5], [-5, -5], [0.02, -0.3]]) {
      if (!inside(st)) continue;
      const r = cm.resizeFromEdge(st, edge, dx, dy, ratio, dA);
      const horiz = edge === 't' || edge === 'b';
      const sc = horiz ? st.x + st.w / 2 : st.y + st.h / 2, rc = horiz ? r.x + r.w / 2 : r.y + r.h / 2;
      const anch = { t: [r.y + r.h, st.y + st.h], b: [r.y, st.y], l: [r.x + r.w, st.x + st.w], r: [r.x, st.x] }[edge];
      if (!(near(r.w / r.h, k, 1e-9) && inside(r) && r.w >= 0.05 - E && r.h >= 0.05 - E && near(sc, rc, 1e-9) && near(anch[0], anch[1], 1e-9))) {
        edgeOk = false; edgeMsg = `${ratio} ${edge} ${dx},${dy} ${J(r)}`;
      }
    }
  }
  ok(edgeOk, 'cropmath edge locked (1:1, 16:9, original, portrait) keeps ratio, anchor and centre, inside bounds, >= min', edgeMsg);
  const eq = cm.resizeFromEdge(cm.centeredAspectRect(1, 1.5), 'r', 0.05, 0, 1, 1.5);
  ok(near(eq.w * 1.5 / eq.h, 1) && near(eq.y + eq.h / 2, 0.5) && eq.h < 1 + E, 'cropmath edge r locked 1:1 grows w, h follows around centre', J(eq));

  let mvOk = true;
  for (const [dx, dy] of [[1, 1], [-1, -1], [0.3, -0.9], [-0.05, 0.1]]) {
    const m = cm.moveRect(s0, dx, dy);
    if (!(inside(m) && near(m.w, s0.w) && near(m.h, s0.h))) mvOk = false;
  }
  ok(mvOk, 'cropmath moveRect stays inside, preserves size');

  const o1 = cm.outputSize(4000, 3000, { x: 0, y: 0, w: 1, h: 1 }, 1, 2048);
  ok(o1.w === 1536 && o1.h === 2048, 'cropmath outputSize rotated capped {1536,2048}', J(o1));
  const o2 = cm.outputSize(1000, 500, { x: 0, y: 0, w: 0.5, h: 1 }, 0, 2048);
  ok(o2.w === 500 && o2.h === 500, 'cropmath outputSize no upscale {500,500}', J(o2));

  const t1 = cm.thumbSize(4000, 3000), t2 = cm.thumbSize(1000, 4000), t3 = cm.thumbSize(1, 1);
  ok(t1.w === 320 && t1.h === 240, 'cropmath thumbSize 4000x3000', J(t1));
  ok(t2.w === 80 && t2.h === 320, 'cropmath thumbSize 1000x4000', J(t2));
  ok(t3.w >= 1 && t3.h >= 1, 'cropmath thumbSize 1x1 >= 1', J(t3));

  // 6. gallery rows + duplicate naming
  {
    const cm = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'editor', 'cropmath.js')).href);
    const aspects = [1.6, 0.6, 1, 1.5, 0.75, 1, 2.4, 0.5];
    const W = 1000, H = 220, G = 2;
    const rows = cm.justifyRows(aspects, W, H, G);
    ok(rows.length && rows[0].start === 0 && rows[rows.length - 1].end === aspects.length, 'justifyRows covers every item in order');
    ok(rows.every((r, i) => i === 0 || r.start === rows[i - 1].end), 'justifyRows rows are contiguous');
    const full = rows.slice(0, -1).every((r) => {
      const w = aspects.slice(r.start, r.end).reduce((a, b) => a + b * r.height, 0) + G * (r.end - r.start - 1);
      return Math.abs(w - W) < 1e-6 && r.height <= H + 1e-9;
    });
    ok(full, 'justifyRows full rows fill width exactly, no taller than target');
    const last = rows[rows.length - 1];
    ok(last.height <= H + 1e-9, 'justifyRows last row not stretched past target');
    ok(cm.justifyRows([], W, H).length === 0, 'justifyRows empty list');
    const one = cm.justifyRows([10], W, H, G);
    ok(one.length === 1 && Math.abs(one[0].height - 100) < 1e-9, 'justifyRows panorama fills a row at its natural height', JSON.stringify(one));
  }
  {
    const st = await import(storeUrl);
    ok(st.copyName('a.jpg', new Set()) === 'a copy.jpg', "copyName 'a copy.jpg'");
    ok(st.copyName('a.jpg', new Set(['a copy.jpg'])) === 'a copy 2.jpg', "copyName skips taken -> 'a copy 2.jpg'");
    ok(st.copyName('a copy.jpg', new Set(['a copy.jpg'])) === 'a copy 2.jpg', 'copyName of a copy does not stack "copy copy"');
    const aid = 'al_t'; st.state.albums.set(aid, { id: aid, name: 't', photoIds: [] });
    st.state.photos.set('p1', { id: 'p1', albumId: aid, name: 'x.png', params: st.defaultParams() });
    st.state.photos.set('p2', { id: 'p2', albumId: aid, name: 'y.png', params: st.defaultParams() });
    st.state.albums.get(aid).photoIds.push('p1', 'p2');
    st.state.photos.get('p1').params.exposure = 30;
    const cp = st.duplicatePhoto('p1');
    const ids = st.state.albums.get(aid).photoIds;
    ok(cp && ids[1] === cp.id && ids.length === 3, 'duplicatePhoto inserts right after original');
    ok(cp.name === 'x copy.png' && cp.params.exposure === 30, 'duplicatePhoto keeps edits, renames');
    cp.params.exposure = 0; cp.params.crop.w = 0.5;
    ok(st.state.photos.get('p1').params.exposure === 30 && st.state.photos.get('p1').params.crop.w === 1, 'duplicate params are independent (deep copy)');
  }
  // needsSave / paramsSig: what "save to folder" has to write
  {
    const st = await import(storeUrl);
    const dir = {};
    const mk = (o = {}) => ({ dir, handle: {}, params: st.defaultParams(), ...o });
    ok(st.needsSave(mk()) === false, 'needsSave: untouched folder photo is not written');
    ok(st.needsSave({ params: st.defaultParams(), handle: {} }) === false && st.needsSave({ params: st.defaultParams(), handle: {}, savedParams: {} }) === false, 'needsSave: photo without a folder never');
    const e = mk(); e.params.exposure = 20;
    ok(st.needsSave(e) === true, 'needsSave: edited, never saved');
    e.savedParams = structuredClone(e.params);
    ok(st.needsSave(e) === false && st.isEdited(e) === true, 'needsSave: saved edit is clean but still edited');
    e.params.texts.push({ text: 'hi' });
    ok(st.needsSave(e) === true, 'needsSave: changed after save');
    e.savedParams = structuredClone(e.params);
    e.params = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(e.params).reverse())));
    ok(st.needsSave(e) === false, 'needsSave: key order does not matter');
    Object.assign(e.params, st.defaultParams());
    ok(st.needsSave(e) === true, 'needsSave: reset after save must be written back');
    ok(st.needsSave(mk({ handle: undefined })) === true, 'needsSave: copy without file always');
    const orig = mk({ savedParams: {}, createdHere: true });
    orig.params.exposure = 5;
    st.state.albums.set('al_s', { id: 'al_s', name: 's', photoIds: [] });
    st.state.photos.set('s1', { id: 's1', albumId: 'al_s', name: 'z.jpg', ...orig });
    st.state.albums.get('al_s').photoIds.push('s1');
    const c2 = st.duplicatePhoto('s1');
    ok(!c2.handle && !c2.savedParams && !c2.createdHere && st.needsSave(c2), 'duplicate of a saved photo is a new, unsaved file');
  }

  // 7. filters (iOS Photos set)
  {
    const fm = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'editor', 'filters.js')).href);
    const order = ['original', 'vivid', 'vividWarm', 'vividCool', 'dramatic', 'dramaticWarm', 'dramaticCool', 'mono', 'silvertone', 'noir'];
    ok(fm.FILTERS.length === 10, 'FILTERS has 10 entries');
    ok(new Set(fm.FILTERS.map((f) => f.id)).size === 10, 'FILTERS ids are unique');
    ok(fm.FILTERS.map((f) => f.id).join() === order.join(), 'FILTERS order matches iOS list', fm.FILTERS.map((f) => f.id).join());
    ok(fm.FILTERS.every((f) => typeof f.label === 'string' && f.label.length), 'FILTERS all have labels');
    ok(fm.FILTERS[0].label === 'Original' && fm.FILTERS[2].label === 'Vivid Warm', 'FILTERS iOS labels');
    ok(order.every((id, i) => fm.filterIndex(id) === i), 'filterIndex maps all 10 ids');
    ok(fm.filterIndex('sepia') === 0 && fm.filterIndex(undefined) === 0 && fm.filterIndex(null) === 0 && fm.filterIndex('') === 0, 'filterIndex unknown/missing -> 0');
  }

  // 8. exif (copy metadata across re-encode)
  {
    const ex = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'exif.js')).href);
    const ascii = (s) => Array.from(s, (ch) => ch.charCodeAt(0));
    const DATE = '2024:05:06 07:08:09';
    // Build an Exif APP1: TIFF header, IFD0 with Make / Orientation=6 / DateTime, data area.
    function buildApp1(le) {
      const u16 = (v) => (le ? [v & 255, v >> 8] : [v >> 8, v & 255]);
      const u32 = (v) => (le ? [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24] : [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255]);
      const make = ascii('Canon\0'), date = ascii(DATE + '\0');
      const dataStart = 8 + 2 + 3 * 12 + 4; // header + count + entries + next-IFD
      const tiff = [
        ...(le ? ascii('II') : ascii('MM')), ...u16(42), ...u32(8),
        ...u16(3),
        ...u16(0x010F), ...u16(2), ...u32(make.length), ...u32(dataStart),
        ...u16(0x0112), ...u16(3), ...u32(1), ...u16(6), 0, 0,
        ...u16(0x0132), ...u16(2), ...u32(date.length), ...u32(dataStart + make.length),
        ...u32(0),
        ...make, ...date,
      ];
      const payload = [...ascii('Exif\0\0'), ...tiff];
      const len = payload.length + 2;
      return [0xFF, 0xE1, len >> 8, len & 255, ...payload];
    }
    const APP0 = [0xFF, 0xE0, 0x00, 0x10, ...ascii('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0];
    const DQT = [0xFF, 0xDB, 0x00, 0x05, 0x00, 0x11, 0x22];
    const TAIL = [0xFF, 0xDA, 0x00, 0x04, 0x01, 0x00, 0xAB, 0xCD, 0xFF, 0xD9]; // SOS, data, EOI
    const jpeg = (...segs) => new Uint8Array([0xFF, 0xD8, ...segs.flat(), ...TAIL]);
    const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
    const ORI = 10 + 8 + 2 + 12 + 8; // value field of 2nd IFD0 entry within APP1
    const readOri = (a, le) => (le ? a[ORI] | (a[ORI + 1] << 8) : (a[ORI] << 8) | a[ORI + 1]);
    const countExif = (b) => { let c = 0; for (let i = 0; i + 9 < b.length; i++) if (b[i] === 0xFF && b[i + 1] === 0xE1 && eq(b.subarray(i + 4, i + 10), ascii('Exif\0\0'))) c++; return c; };

    for (const le of [true, false]) {
      const tag = le ? 'II' : 'MM';
      const app1 = new Uint8Array(buildApp1(le));
      const src = jpeg(APP0, [...app1], DQT);
      const got = ex.extractApp1(src);
      ok(got && eq(got, app1), `extractApp1 returns exact APP1 (${tag})`);
      ok(readOri(app1, le) === 6, `fixture Orientation is 6 (${tag})`);
      const before = app1.slice();
      const fixed = ex.setOrientation1(app1);
      ok(fixed !== app1 && eq(app1, before), `setOrientation1 does not mutate input (${tag})`);
      ok(readOri(fixed, le) === 1, `setOrientation1 Orientation reads 1 (${tag})`, String(readOri(fixed, le)));
      ok(fixed.length === app1.length && Array.from(fixed).every((v, i) => i === ORI || i === ORI + 1 || v === app1[i]), `setOrientation1 leaves other bytes identical (${tag})`);
      const bare = jpeg(DQT);
      const out = ex.copyExif(src, bare);
      const dateBytes = ascii(DATE);
      const hasDate = Array.from(out).some((_, i) => eq(out.subarray(i, i + dateBytes.length), dateBytes));
      const exOut = ex.extractApp1(out);
      ok(hasDate && exOut && readOri(exOut, le) === 1, `copyExif end-to-end keeps DateTime, Orientation 1 (${tag})`);
    }
    const noOri = new Uint8Array(buildApp1(true)); noOri[10 + 8 + 2 + 12] = 0x13; // retag Orientation entry
    ok(eq(ex.setOrientation1(noOri), noOri), 'setOrientation1 without Orientation returns unchanged copy');
    ok(eq(ex.setOrientation1(new Uint8Array([1, 2, 3])), [1, 2, 3]), 'setOrientation1 malformed returns copy, no throw');

    // Edits must not leave the original's preview thumbnail or pixel size behind.
    {
      const le32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24];
      const le16 = (v) => [v & 255, v >> 8];
      const ent = (tag, type, v) => [...le16(tag), ...le16(type), ...le32(1), ...le32(v)];
      const thumb = [0xFF, 0xD8, 0xFF, 0xDB, 0x00, 0x03, 0x00, 0xFF, 0xD9];
      const tiff = [0x49, 0x49, 42, 0, 8, 0, 0, 0,
        ...le16(2), ...ent(0x0112, 3, 6), ...ent(0x8769, 4, 38), ...le32(68),
        ...le16(2), ...ent(0xA002, 4, 4000), ...ent(0xA003, 4, 3000), ...le32(0),
        ...le16(2), ...ent(0x0201, 4, 98), ...ent(0x0202, 4, thumb.length), ...le32(0),
        ...thumb];
      const payload = [...ascii('Exif\0\0'), ...tiff];
      const app1 = new Uint8Array([0xFF, 0xE1, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload]);
      const r = ex.refreshForEdit(app1, { width: 1234, height: 987 });
      const rd32 = (a, o) => (a[o] | (a[o + 1] << 8) | (a[o + 2] << 16) | (a[o + 3] << 24)) >>> 0;
      ok(r.length === app1.length - thumb.length && ((r[2] << 8) | r[3]) === r.length - 2, 'refreshForEdit cuts a tail-aligned thumbnail and fixes the segment length');
      ok(rd32(r, 10 + 8 + 2 + 24) === 0, 'refreshForEdit clears the IFD0 -> IFD1 link');
      ok(rd32(r, 10 + 38 + 2 + 8) === 1234 && rd32(r, 10 + 38 + 2 + 12 + 8) === 987, 'refreshForEdit writes the new PixelX/YDimension');
      ok(eq(app1.slice(0, 4), [0xFF, 0xE1, app1[2], app1[3]]) && app1.length === payload.length + 4, 'refreshForEdit does not mutate input');
      const bare = jpeg(DQT);
      const sof = new Uint8Array([0xFF, 0xD8, 0xFF, 0xC0, 0, 11, 8, 0x03, 0xDB, 0x04, 0xD2, 1, 1, 0x11, 0, 0xFF, 0xD9]);
      const sz = ex.jpegSize(sof);
      ok(sz && sz.width === 1234 && sz.height === 987, 'jpegSize reads SOF dimensions', JSON.stringify(sz));
      const whole = ex.copyExif(jpeg(APP0, [...app1], DQT), new Uint8Array([...sof.slice(0, 2), ...[0xFF, 0xDB, 0x00, 0x05, 0x00, 0x11, 0x22], ...sof.slice(2)]));
      const got = ex.extractApp1(whole);
      ok(got && got.length === app1.length - thumb.length && rd32(got, 10 + 8 + 2 + 24) === 0, 'copyExif drops the thumbnail end to end');
      ok(ex.refreshForEdit(new Uint8Array([1, 2, 3]), { width: 1, height: 1 }).length === 3, 'refreshForEdit malformed returns copy, no throw');
    }

    const xmp = [...ascii('http://ns.adobe.com/xap/1.0/\0'), ...ascii('<x/>')];
    const xmpSeg = [0xFF, 0xE1, (xmp.length + 2) >> 8, (xmp.length + 2) & 255, ...xmp];
    ok(ex.extractApp1(jpeg(APP0, xmpSeg, DQT)) === null, 'extractApp1 XMP-only -> null');
    ok(ex.extractApp1(new Uint8Array([1, 2, 3, 4, 5])) === null, 'extractApp1 garbage -> null');
    const full = jpeg(APP0, buildApp1(true), DQT);
    ok(ex.extractApp1(full.subarray(0, 30)) === null, 'extractApp1 truncated -> null');
    ok(ex.extractApp1(jpeg([0xFF, 0xFF, 0xFF], buildApp1(true))) !== null, 'extractApp1 tolerates FF fill bytes');

    const app1 = new Uint8Array(buildApp1(false));
    const plain = jpeg(APP0, DQT);
    const ins = ex.insertApp1(plain, app1);
    ok(ins[0] === 0xFF && ins[1] === 0xD8 && eq(ins.subarray(2, 2 + APP0.length), APP0) && eq(ins.subarray(2 + APP0.length, 2 + APP0.length + app1.length), app1), 'insertApp1 order SOI, APP0, APP1');
    ok(eq(ins.subarray(ins.length - TAIL.length), TAIL), 'insertApp1 preserves SOS..EOI at end');
    ok(ins.length === plain.length + app1.length, 'insertApp1 length grows by APP1 only');
    const already = jpeg(APP0, buildApp1(true), DQT);
    const ins2 = ex.insertApp1(already, app1);
    ok(countExif(ins2) === 1 && eq(ex.extractApp1(ins2), app1), 'insertApp1 replaces existing Exif (exactly one)');
    ok(ex.insertApp1(plain, null) === plain, 'insertApp1 null app1 -> unchanged');
    const notJpeg = new Uint8Array([9, 9, 9]);
    ok(ex.insertApp1(notJpeg, app1) === notJpeg, 'insertApp1 non-JPEG -> unchanged');
    ok(ex.copyExif(plain, full) === full, 'copyExif with no EXIF in original -> unchanged');
  }

  // 8. textmath: text-layer geometry
  {
    const tm = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'editor', 'textmath.js')).href);
    const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
    const quad = [[0.1, 0.2], [0.7, 0.1], [0.8, 0.9], [0.2, 0.7]];
    const H = tm.squareToQuad(quad);
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => tm.apply(H, u, v));
    ok(corners.every((c, i) => near(c[0], quad[i][0]) && near(c[1], quad[i][1])), 'textmath squareToQuad hits all 4 corners');
    const Hi = tm.inv(H);
    const back = tm.apply(Hi, ...tm.apply(H, 0.3, 0.6));
    ok(near(back[0], 0.3) && near(back[1], 0.6), 'textmath inv round-trips a homography');

    // outToSrc must equal the preview shader (straighten, rotUV, crop) for every rotation.
    const shader = (t, p, W, Hh) => {
      let [x, y] = t;
      const A = W / Hh, rad = p.straighten * Math.PI / 180;
      if (Math.abs(rad) > 1e-5) {
        const cs = Math.cos(rad), sn = Math.sin(rad), zoom = cs + Math.abs(sn) * Math.max(A, 1 / A);
        const qx = (x - 0.5) * A, qy = y - 0.5;
        const rx = (cs * qx - sn * qy) / zoom, ry = (sn * qx + cs * qy) / zoom;
        x = rx / A + 0.5; y = ry + 0.5;
      }
      const s = p.rotation / 90;
      [x, y] = s === 1 ? [1 - y, x] : s === 2 ? [1 - x, 1 - y] : s === 3 ? [y, 1 - x] : [x, y];
      return [p.crop.x + x * p.crop.w, p.crop.y + y * p.crop.h];
    };
    let mapOk = true, mapMsg = '';
    for (const rotation of [0, 90, 180, 270]) for (const straighten of [0, 7.5, -30]) {
      const p = { crop: { x: 0.1, y: 0.25, w: 0.6, h: 0.5 }, rotation, straighten };
      const M = tm.outToSrc(p, 1200, 800);
      for (const t of [[0, 0], [1, 0], [0.3, 0.8], [1, 1], [0.5, 0.5]]) {
        const a = tm.apply(M, ...t), b = shader(t, p, 1200, 800);
        if (!near(a[0], b[0], 1e-9) || !near(a[1], b[1], 1e-9)) { mapOk = false; mapMsg = `rot ${rotation} str ${straighten} t ${t}`; }
      }
      const f = tm.frameMap(p, 1200, 800);
      const rt = tm.apply(f.toOut, ...tm.apply(f.toSrc, 0.25, 0.75));
      if (!near(rt[0], 0.25) || !near(rt[1], 0.75)) { mapOk = false; mapMsg = 'frameMap round-trip'; }
    }
    ok(mapOk, 'textmath outToSrc matches shader (4 rotations x straighten) + frameMap inverse', mapMsg);

    // rotation 90 is the ⟲ button: source pixels turn 90° counter-clockwise on screen.
    const f90 = tm.frameMap({ crop: { x: 0, y: 0, w: 1, h: 1 }, rotation: 90, straighten: 0 }, 300, 400);
    ok(near(tm.displayAngle(f90.toOut, 300, 400, 400, 300), -90, 1e-6), 'textmath displayAngle -90 for ⟲ rotated photo',
      String(tm.displayAngle(f90.toOut, 300, 400, 400, 300)));
    const f0 = tm.frameMap({ crop: { x: 0, y: 0, w: 0.5, h: 0.5 }, rotation: 0, straighten: 0 }, 200, 150);
    ok(near(tm.displayScale(f0.toOut, 200, 150, 400), 1, 1e-9), 'textmath displayScale of a half crop at half size is 1');

    const pl = { mode: '2d', cx: 0.5, cy: 0.5, size: 0.1, rot: 0 };
    const q2 = tm.placeQuad(pl, { w: 4, h: 1.2 }, 2000, 1000);
    ok(near(q2[0][0], 0.4) && near(q2[1][0], 0.6) && near(q2[0][1], 0.44) && near(q2[3][1], 0.56), '2d quad: size in image-height units, aspect-correct', JSON.stringify(q2));
    const q90 = tm.placeQuad({ ...pl, rot: 90 }, { w: 4, h: 1.2 }, 2000, 1000);
    ok(near((q90[1][1] - q90[0][1]) * 1000, 400, 1e-6) && near(q90[1][0], q90[0][0], 1e-9), '2d quad rot 90 turns the top edge vertical');
    const qt = tm.placeQuad({ ...pl, mode: 'tilt', rx: 0, ry: -40, persp: 60 }, { w: 4, h: 1.2 }, 2000, 1000);
    const hl = qt[3][1] - qt[0][1], hr = qt[2][1] - qt[1][1];
    ok(tm.isConvexQuad(qt, 2000, 1000) && Math.abs(hl - hr) > 0.005, 'tilt quad is convex with one side nearer', `${hl} ${hr}`);
    const qf = tm.placeQuad({ ...pl, mode: 'tilt', rx: 0, ry: 0, persp: 60 }, { w: 4, h: 1.2 }, 2000, 1000);
    ok(qf.every((c, i) => near(c[0], q2[i][0]) && near(c[1], q2[i][1])), 'tilt with no rotation equals 2d');
    ok(!tm.isConvexQuad([[0, 0], [1, 1], [1, 0], [0, 1]]), 'isConvexQuad rejects a bow-tie');
    ok(tm.pointInQuad(quad, 0.45, 0.5) && !tm.pointInQuad(quad, 0.05, 0.05), 'pointInQuad inside / outside');
    const c = tm.quadCenter([[0, 0], [1, 0], [1, 1], [0, 1]]);
    ok(near(c[0], 0.5) && near(c[1], 0.5), 'quadCenter of the unit square');
    const S = tm.spriteToClip(quad, tm.frameMap({ crop: { x: 0, y: 0, w: 1, h: 1 }, rotation: 0, straighten: 0 }, 100, 100).toOut);
    const w = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => S[6] * u + S[7] * v + S[8]);
    const tl = tm.apply(S, 0, 0);
    ok(w.every((x) => x > 0) && near(tl[0], -0.8) && near(tl[1], 0.6), 'spriteToClip: w > 0 and TL lands in clip space', JSON.stringify(tl));

    const st = await import(storeUrl);
    const pt = st.defaultParams();
    ok(Array.isArray(pt.texts) && pt.texts.length === 0, 'defaultParams texts []');
    pt.texts = [{ text: '  ' }];
    ok(st.isEdited({ params: pt }) === false, 'isEdited ignores blank text');
    pt.texts = [{ text: 'EMILY' }];
    ok(st.isEdited({ params: pt }) === true, 'isEdited true with a text layer');
  }

  // 9. zoom: inspect zoom math
  {
    const zm = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'editor', 'zoom.js')).href);
    const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
    const z = zm.zoomAt({ s: 1, tx: 0, ty: 0 }, 2, 50, -20);
    // The photo point under the pointer stays put: (q - t) / s is unchanged.
    ok(near((50 - z.tx) / z.s, 50) && near((-20 - z.ty) / z.s, -20), 'zoomAt keeps the clicked point under the pointer', JSON.stringify(z));
    const z2 = zm.zoomAt(z, 4, 10, 10);
    ok(near((10 - z2.tx) / 4, (10 - z.tx) / 2) && near((10 - z2.ty) / 4, (10 - z.ty) / 2), 'zoomAt composes from a zoomed view');
    const c = zm.clampView({ s: 2, tx: 999, ty: -999 }, 400, 300, 600, 500);
    ok(c.tx === 100 && c.ty === -50, 'clampView stops panning at the photo edges', JSON.stringify(c));
    const fit = zm.clampView({ s: 2, tx: 80, ty: 40 }, 200, 100, 600, 500);
    ok(fit.tx === 0 && fit.ty === 0, 'clampView centers an axis that still fits');
    const out = zm.clampView({ s: 0.4, tx: 30, ty: 30 }, 400, 300, 600, 500);
    ok(out.s === 1 && out.tx === 0 && out.ty === 0, 'clampView snaps back to fit below 1x');
    ok(zm.clampView({ s: 99, tx: 0, ty: 0 }, 400, 300, 600, 500).s === zm.MAX_ZOOM, 'clampView caps at MAX_ZOOM');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL harness — ' + (e && e.message)); process.exit(1); });
