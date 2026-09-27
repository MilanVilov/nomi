// Single-pass WebGL2 preview engine. Same shader reused for full-res export.
import { outputSize, rotSteps } from './cropmath.js';
import { filterIndex } from './filters.js';
import { getSprite, measure } from './textsprite.js';
import { frameMap, placeQuad, spriteToClip, apply } from './textmath.js';

// Text overlay: a sprite on a projective quad, blended with the photo underneath (read from a copy of the frame).
const TVS = `#version 300 es
in vec2 aUV; out vec2 vUV;
uniform mat3 uH; // sprite uv -> clip (projective)
void main(){ vec3 p = uH * vec3(aUV, 1.0); gl_Position = vec4(p.xy, 0.0, p.z); vUV = aUV; }`;

const TFS = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 outColor;
uniform sampler2D uSprite, uBg;
uniform vec2 uSize; // framebuffer px
uniform float uOpacity, uTexture, uLight;
uniform int uMode; // 0 normal, 1 multiply, 2 screen, 3 overlay
float lum(vec3 c){ return dot(c, vec3(0.2126,0.7152,0.0722)); }
// Mean luminance on a ring of radius r (fraction of frame height), so preview and full-res export match.
float meanAt(vec2 uv, float r){
  float m = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398;
    m += lum(texture(uBg, uv + vec2(cos(a), sin(a)) * r * vec2(uSize.y / uSize.x, 1.0)).rgb);
  }
  return m * 0.125;
}
void main(){
  vec2 bc = gl_FragCoord.xy / uSize;
  vec3 b = texture(uBg, bc).rgb;
  vec4 s = texture(uSprite, vUV); // premultiplied
  float a = s.a * uOpacity;
  if (a < 0.002) { outColor = vec4(b, 1.0); return; }
  vec3 c = s.rgb / max(s.a, 1e-4);
  if (uTexture > 0.0) {
    // Surface detail of the photo under the text: grain and cracks show through the paint.
    float d = lum(b) - meanAt(bc, 0.0025);
    c += d * uTexture * 1.6;
    a *= 1.0 - clamp(-d * uTexture * 4.0, 0.0, 0.7);
  }
  if (uLight > 0.0) {
    // Scene shading: text takes on the light falling on the surface.
    float m = meanAt(bc, 0.03);
    c *= mix(1.0, clamp(m / 0.62, 0.25, 1.25), uLight);
  }
  c = clamp(c, 0.0, 1.0);
  vec3 r = c;
  if (uMode == 1) r = b * c;
  else if (uMode == 2) r = 1.0 - (1.0 - b) * (1.0 - c);
  else if (uMode == 3) r = mix(2.0 * b * c, 1.0 - 2.0 * (1.0 - b) * (1.0 - c), step(0.5, b));
  outColor = vec4(mix(b, r, a), 1.0);
}`;
const BLEND = { normal: 0, multiply: 1, screen: 2, overlay: 3 };

const VS = `#version 300 es
in vec2 aPos; in vec2 aUV; out vec2 vUV;
void main(){ gl_Position=vec4(aPos,0.,1.); vUV=aUV; }`;

const FS = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 outColor;
uniform sampler2D uTex;
// Apple-like params, -100..100
uniform float uExposure,uBrilliance,uHighlights,uShadows,uContrast,uBrightness,uBlackpoint;
uniform float uSaturation,uVibrance,uWarmth,uTint;
uniform vec4 uCrop; // x,y,w,h normalized
uniform float uRotSteps; // 0..3 (90deg cw)
uniform vec2 uTexSize;
uniform float uRot; // straighten radians
uniform float uOutAspect; // output frame w/h
uniform float uFilter; // filters.js index; 0 = original (no-op)
uniform float uFilterAmount; // 0..1

vec2 rotUV(vec2 uv){
  if(uRotSteps<0.5) return uv;
  if(uRotSteps<1.5) return vec2(1.0-uv.y, uv.x);
  if(uRotSteps<2.5) return vec2(1.0-uv.x, 1.0-uv.y);
  return vec2(uv.y, 1.0-uv.x);
}
float lum(vec3 c){ return dot(c, vec3(0.2126,0.7152,0.0722)); }

// ---- iOS Photos-style filters (applied after all adjustments) ----
vec3 fSat(vec3 x, float s){ return mix(vec3(lum(x)), x, s); }
// Smoothstep S-curve blend; k in 0..1 per pass (apply twice for steeper).
vec3 fCon(vec3 x, float k){ x = clamp(x, 0.0, 1.0); return mix(x, x*x*(3.0 - 2.0*x), k); }
float fConF(float x, float k){ x = clamp(x, 0.0, 1.0); return mix(x, x*x*(3.0 - 2.0*x), k); }
// Local mean luminance of the source around output-frame point t (8 taps, frame-relative radius).
float localMean(vec2 t){
  vec2 r = vec2(0.018 / max(uOutAspect, 1e-3), 0.018);
  float m = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398;
    vec2 uv = rotUV(t + vec2(cos(a), sin(a)) * r);
    uv = clamp(uCrop.xy + uv * uCrop.zw, vec2(0.001), vec2(0.999));
    m += lum(texture(uTex, uv).rgb);
  }
  return m * 0.125;
}
float vignette(vec2 t, float strength){
  vec2 q = (t - 0.5) * vec2(uOutAspect, 1.0);
  float d = length(q) / length(vec2(uOutAspect, 1.0) * 0.5); // 0 center .. 1 corner
  return 1.0 - strength * smoothstep(0.35, 1.05, d);
}
vec3 applyFilter(vec3 c, vec2 t, float srcL, int f){
  vec3 x = clamp(c, 0.0, 1.0);
  if (f <= 3) { // Vivid family
    x = x * 1.03 + 0.012;                 // slightly brighter
    x = fCon(x, 0.32);                    // more contrast
    x = fSat(x, 1.32);                    // more saturation
    if (f == 2) x *= vec3(1.06, 1.0, 0.88);
    if (f == 3) x *= vec3(0.91, 0.99, 1.07);
    return x;
  }
  if (f <= 6) { // Dramatic family
    float lm = localMean(t);
    x += (srcL - lm) * 0.35;              // local contrast / clarity
    x = clamp(x, 0.0, 1.0);
    x = x * 0.92;                         // lower brightness
    x = x / (1.0 + x * 0.22);             // crush highlights
    x = fCon(x, 0.8); x = fCon(x, 0.2);   // steep S-curve
    x = fSat(x, 0.68);                    // desaturate
    if (f == 5) x *= vec3(1.07, 1.0, 0.87);
    if (f == 6) x *= vec3(0.90, 0.99, 1.09);
    return x;
  }
  float y = lum(x);
  if (f == 7) { // Mono: neutral B&W
    y = fConF(y, 0.18);
    return vec3(y);
  }
  if (f == 8) { // Silvertone: bright, low contrast, faint cool silver
    y = pow(clamp(y, 0.0, 1.0), 0.82);
    y = 0.07 + 0.90 * y;
    return clamp(vec3(y) * vec3(0.985, 1.0, 1.025), 0.0, 1.0);
  }
  // Noir: high contrast, deep blacks, slight vignette
  y = clamp((y - 0.06) / 0.97, 0.0, 1.0);
  y = y / (1.0 + y * 0.12);             // hold highlight detail
  y = fConF(y, 1.0); y = fConF(y, 0.2);
  y *= vignette(t, 0.38);
  return vec3(y);
}
void main(){
  // ImageBitmap upload is top-row-first; quad vUV is bottom-origin -> flip to top-origin, then crop/rotate in top-origin space.
  vec2 t = vec2(vUV.x, 1.0 - vUV.y);
  // Straighten: rotate the output frame in aspect-correct space and zoom so no empty corners show.
  if (abs(uRot) > 1e-5) {
    vec2 k = vec2(uOutAspect, 1.0);
    float cs = cos(uRot), sn = sin(uRot);
    float zoom = cs + abs(sn) * max(uOutAspect, 1.0 / uOutAspect);
    vec2 q = (t - 0.5) * k;
    q = mat2(cs, sn, -sn, cs) * q / zoom;
    t = q / k + 0.5;
  }
  vec2 uv = rotUV(t);
  uv = uCrop.xy + uv * uCrop.zw;
  uv = clamp(uv, vec2(0.001), vec2(0.999));
  vec3 c = texture(uTex, uv).rgb;
  float srcL = lum(c);

  // exposure (EV)
  // Brightening compresses toward white instead of clipping (whites stay white, mids lift).
  float g = pow(2.0, uExposure*0.02);
  c = g > 1.0 ? c*g / (1.0 + c*(g - 1.0)) : c*g;
  // brightness linear lift
  c += uBrightness*0.0018;
  // black point
  c = (c - uBlackpoint*0.0012) / max(0.001,(1.0 - uBlackpoint*0.0012));
  // contrast around 0.5
  // S-curve around mid-grey; endpoints stay fixed so contrast never clips on its own.
  vec3 cc = clamp(c, 0.0, 1.0);
  vec3 s = cc*cc*(3.0 - 2.0*cc);
  c += (s - cc) * (uContrast*0.01);
  float l = lum(c);
  // shadows / highlights (masked)
  float shM = 1.0-smoothstep(0.0,0.55,l);
  float hiM = smoothstep(0.45,1.0,l);
  c *= (1.0 + uShadows*0.004*shM);
  c *= (1.0 + uHighlights*0.004*hiM);
  // brilliance: lift mids, tame extremes
  float br = uBrilliance*0.0022;
  float midM = smoothstep(0.0,0.35,l)*(1.0-smoothstep(0.65,1.0,l));
  c += br*midM - br*0.35*hiM*sign(br) + br*0.25*shM;
  // saturation / vibrance
  float sat = 1.0 + uSaturation*0.012;
  float vib = uVibrance*0.010;
  float avg = (c.r+c.g+c.b)/3.0;
  float amt = abs(avg-l);
  float vibM = 1.0-smoothstep(0.0,0.6,amt);
  c = mix(vec3(avg), c, sat*(1.0+vib*vibM));
  // warmth / tint
  c.r += uWarmth*0.0016; c.b -= uWarmth*0.0016;
  c.g += uTint*0.0012;
  // filter (iOS-style look), mixed by intensity; index 0 = original = untouched
  int fi = int(uFilter + 0.5);
  if (fi > 0) c = mix(c, applyFilter(c, t, srcL, fi), uFilterAmount);
  // warmth white-balance-ish green-magenta guard
  c = clamp(c, 0.0, 1.0);
  outColor = vec4(c,1.0);
}`;

export function createEngine(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, depth: false, preserveDrawingBuffer: true });
  if (!gl) return null;
  const prog = link(gl, VS, FS);
  const loc = n => gl.getUniformLocation(prog, n);
  const U = {
    tex: loc('uTex'), exposure: loc('uExposure'), brilliance: loc('uBrilliance'),
    highlights: loc('uHighlights'), shadows: loc('uShadows'), contrast: loc('uContrast'),
    brightness: loc('uBrightness'), blackpoint: loc('uBlackpoint'),
    saturation: loc('uSaturation'), vibrance: loc('uVibrance'), warmth: loc('uWarmth'), tint: loc('uTint'),
    crop: loc('uCrop'), rot: loc('uRotSteps'), rotRad: loc('uRot'), outAspect: loc('uOutAspect'), texSize: loc('uTexSize'),
    filter: loc('uFilter'), filterAmount: loc('uFilterAmount'),
  };
  // fullscreen quad
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,0,0, 1,-1,1,0, -1,1,0,1, 1,1,1,1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'aPos'), aUV = gl.getAttribLocation(prog, 'aUV');
  gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(aUV); gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 16, 8);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  // Orientation is handled by the v-flip in the fragment shader (no UNPACK_FLIP_Y_WEBGL).

  // Text overlay program: unit-square quad, sprite textures, and a copy of the frame to blend against.
  const tprog = link(gl, TVS, TFS);
  const tl = (n) => gl.getUniformLocation(tprog, n);
  const TU = { H: tl('uH'), sprite: tl('uSprite'), bg: tl('uBg'), size: tl('uSize'), opacity: tl('uOpacity'),
    texture: tl('uTexture'), light: tl('uLight'), mode: tl('uMode') };
  const tvao = gl.createVertexArray(); gl.bindVertexArray(tvao);
  const tbuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, tbuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const aTUV = gl.getAttribLocation(tprog, 'aUV');
  gl.enableVertexAttribArray(aTUV); gl.vertexAttribPointer(aTUV, 2, gl.FLOAT, false, 8, 0);
  gl.bindVertexArray(vao);
  const bgTex = newTex(gl);
  let bgW = 0, bgH = 0;
  const spriteTex = new Map(); // sprite key -> texture
  const maxTex = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096);

  let imgW = 0, imgH = 0; // source (uncapped) dims
  let texW = 0, texH = 0; // capped/uploaded dims

  function setImage(bitmapOrImg, maxEdge = 2048) {
    let w, h, src = bitmapOrImg;
    w = bitmapOrImg.width || bitmapOrImg.naturalWidth;
    h = bitmapOrImg.height || bitmapOrImg.naturalHeight;
    const s = Math.min(1, maxEdge / Math.max(w, h));
    const dw = Math.max(1, Math.round(w * s)), dh = Math.max(1, Math.round(h * s));
    canvas.width = dw; canvas.height = dh;
    gl.viewport(0, 0, dw, dh);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    imgW = w; imgH = h; texW = dw; texH = dh;
  }

  function getImageSize() { return { w: imgW, h: imgH }; }

  // Preview only: size the drawing buffer to the rotated crop (longest edge <= maxEdge).
  function fitOutput(p, maxEdge = 2048) {
    if (!imgW || !imgH) return false;
    const crop = (p && p.crop) || { x: 0, y: 0, w: 1, h: 1 };
    const { w, h } = outputSize(imgW, imgH, crop, rotSteps(p && p.rotation), maxEdge);
    if (canvas.width === w && canvas.height === h) return false;
    canvas.width = w; canvas.height = h;
    gl.viewport(0, 0, w, h);
    return true;
  }

  // Letterbox the canvas CSS size inside a box, preserving buffer aspect.
  function layoutContain(boxW, boxH) {
    const bw = Math.max(0, Math.floor(Number(boxW) || 0));
    const bh = Math.max(0, Math.floor(Number(boxH) || 0));
    const cw = canvas.width || 1, ch = canvas.height || 1;
    let w = 0, h = 0;
    if (bw > 0 && bh > 0) {
      const s = Math.min(bw / cw, bh / ch);
      w = Math.min(bw, Math.max(1, Math.round(cw * s)));
      h = Math.min(bh, Math.max(1, Math.round(ch * s)));
    }
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    return { w, h };
  }

  // Never resizes the canvas (exporter sets size + viewport itself).
  function render(p) {
    gl.clearColor(0.161, 0.173, 0.2, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(U.tex, 0);
    gl.uniform1f(U.exposure, p.exposure); gl.uniform1f(U.brilliance, p.brilliance);
    gl.uniform1f(U.highlights, p.highlights); gl.uniform1f(U.shadows, p.shadows);
    gl.uniform1f(U.contrast, p.contrast); gl.uniform1f(U.brightness, p.brightness);
    gl.uniform1f(U.blackpoint, p.blackpoint); gl.uniform1f(U.saturation, p.saturation);
    gl.uniform1f(U.vibrance, p.vibrance); gl.uniform1f(U.warmth, p.warmth); gl.uniform1f(U.tint, p.tint);
    gl.uniform4f(U.crop, p.crop.x, p.crop.y, p.crop.w, p.crop.h);
    gl.uniform1f(U.rot, (p.rotation / 90) % 4);
    gl.uniform1f(U.rotRad, (p.straighten || 0) * Math.PI / 180);
    gl.uniform1f(U.outAspect, gl.drawingBufferWidth / Math.max(1, gl.drawingBufferHeight));
    gl.uniform2f(U.texSize, imgW, imgH);
    const fa = Number(p.filterAmount);
    gl.uniform1f(U.filter, filterIndex(p.filter));
    gl.uniform1f(U.filterAmount, Number.isFinite(fa) ? Math.min(1, Math.max(0, fa / 100)) : 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // Draw text layers over whatever render(p) just produced. p supplies crop/rotation/straighten.
  function renderTexts(layers, p) {
    if (!layers || !layers.length || !imgW) return;
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const map = frameMap(p, W, H);
    gl.useProgram(tprog);
    gl.bindVertexArray(tvao);
    gl.disable(gl.BLEND);
    gl.uniform2f(TU.size, W, H);
    gl.uniform1i(TU.sprite, 0);
    gl.uniform1i(TU.bg, 1);
    const used = new Set();
    for (const l of layers) {
      if (!l || !String(l.text || '').trim()) continue;
      const quad = layerQuad(l, imgW, imgH);
      // Sprite resolution follows the quad's on-screen size (longest side edge, in framebuffer px).
      const px = quad.map(([x, y]) => { const [u, v] = apply(map.toOut, x, y); return [u * W, v * H]; });
      const edge = (a, b) => Math.hypot(px[a][0] - px[b][0], px[a][1] - px[b][1]);
      const sp = getSprite(l, Math.max(edge(0, 3), edge(1, 2)) * 1.15, maxTex);
      let t = spriteTex.get(sp.key);
      gl.activeTexture(gl.TEXTURE0);
      if (!t) {
        t = newTex(gl);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sp.canvas);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        spriteTex.set(sp.key, t);
      } else gl.bindTexture(gl.TEXTURE_2D, t);
      used.add(sp.key);
      // Snapshot the frame (photo + earlier layers) so this layer can blend with it.
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, bgTex);
      if (bgW !== W || bgH !== H) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        bgW = W; bgH = H;
      }
      gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, W, H);
      const b = l.blend || {};
      gl.uniformMatrix3fv(TU.H, true, spriteToClip(quad, map.toOut));
      gl.uniform1f(TU.opacity, Math.min(1, Math.max(0, (b.opacity ?? 100) / 100)));
      gl.uniform1f(TU.texture, Math.max(0, (b.texture || 0) / 100));
      gl.uniform1f(TU.light, Math.max(0, (b.light || 0) / 100));
      gl.uniform1i(TU.mode, BLEND[b.mode] || 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.activeTexture(gl.TEXTURE0);
    if (spriteTex.size > 12) {
      for (const [k, t] of spriteTex) if (!used.has(k)) { gl.deleteTexture(t); spriteTex.delete(k); }
    }
  }

  // 2D fallback when WebGL2 missing
  function render2D(ctx2d, img, p, dw, dh) {
    ctx2d.clearRect(0, 0, dw, dh);
    ctx2d.filter = `brightness(${(1 + p.exposure * 0.01 + p.brightness * 0.005).toFixed(3)}) contrast(${(1 + p.contrast * 0.008).toFixed(3)}) saturate(${(1 + p.saturation * 0.012).toFixed(3)})`;
    ctx2d.drawImage(img, 0, 0, dw, dh);
    ctx2d.filter = 'none';
  }

  return { gl, setImage, render, renderTexts, render2D, layoutContain, fitOutput, getImageSize };
}

// Pin mode keeps its own corners; 2d and tilt derive them from the sprite size every time.
export function layerQuad(l, imgW, imgH) {
  const pl = l.place || {};
  if (pl.mode === 'pin' && Array.isArray(pl.quad) && pl.quad.length === 4) return pl.quad;
  return placeQuad(pl, measure(l), imgW, imgH);
}

function newTex(gl) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return t;
}

function link(gl, vsSrc, fsSrc) {
  const vs = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(vs, vsSrc); gl.compileShader(vs);
  const fs = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(fs, fsSrc); gl.compileShader(fs);
  const pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error('GL link: ' + gl.getProgramInfoLog(pr));
  return pr;
}
