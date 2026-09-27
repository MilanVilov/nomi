# Nomi — minimalist session-only photo editor (MVP)

Separate repo/project at `code/nomi`. Static, no backend, no account.

## Approved v1 (all confirmed)

- Stack: static Vite-less SPA — plain `index.html` + ES modules, no framework. WebGL2 preview, Canvas2D fallback.
- Adjustments (full Apple-like): Exposure, Brilliance, Highlights, Shadows, Contrast, Brightness, Black Point, Saturation, Vibrance, Warmth, Tint.
- Crop: drag box + Free/Original/Square/4:3/3:2/16:9, rotate 90°, straighten ±45° (zooms to fill, like iOS), non-destructive normalized params in source-image space. Crop mode shows the full frame under the overlay; adjust mode shows the cropped result.
- Albums: create/rename, import `image/*` multi + drag-drop, in-memory only (`Map` + `ObjectURL`), thumbnails via `createImageBitmap`.
- Export: one ZIP, full resolution, visually lossless (`image/jpeg` quality 1.0, PNG when source has alpha), filenames preserved (`name-edited.ext`), ZIP `STORE` (no compression) via vendored writer — zero deps.
- Preview cap 2048px long edge; full-res decode only on export in Worker-less async slices to keep UI responsive.
- Style (v2, 2026-09-26): dark, modelled on Claude Code — warm near-black `#1a1918`, ink `#f0eee6`, coral accent `#d97757`, monospace UI, no panels, radius 0. Photo-first editor: photo on the left, tools in a right column tinted from the photo's right edge (`--edge-soft`) with a fade; stacks under the photo below 960px. Full spec: `.agents/skills/nomi-design/SKILL.md`.

## File map

- `index.html` — shell: topbar, albums grid, album detail, editor
- `styles.css` — tokens + layout
- `src/store.js` — albums/photos/params defaults
- `src/importer.js` — decode + thumbnails
- `src/editor/gl.js` — WebGL single-pass engine + fallback
- `src/editor/sliders.js` — slider config + UI
- `src/editor/crop.js` — Apple-style crop overlay (dim, 3×3 grid, L-handles, aspect lock)
- `src/editor/cropmath.js` — pure crop/rotation/output-size math (unit tested)
- `src/exporter.js` — full-res render (same GL) + STORE zip writer + crc32
- `src/app.js` — wiring
- `tests/run.js` — node smoke tests (params, crop clamp, zip round-trip)

## Perf notes

- Sliders update uniforms only, `requestAnimationFrame` throttle.
- Preview texture max 2048px; export re-decodes full-res.
- Revoke ObjectURLs on delete/unload; warn on unload if dirty.
- No persistence (reload loses session by design).

## Verification

- `node tests/run.js` must pass.
- Playwright E2E at 1440×900 and 390×844: file chooser, thumbnail ratios, full-photo fit, rail position, every slider, crop drag/aspect/rotate/straighten, ZIP contents and exported dimensions, zero console errors.
