# Imagery

Photography carries all the color. The UI frames it like a contact sheet: no borders, no frames, a flat `--bg` or `--bg-2` ground behind.

## Showing photos

- **Editor:** letterbox the whole photo in `.stage-wrap` (padding 24, 16 on phones). JS sizes the canvas in px; never stretch with CSS, never crop in preview except through the crop tool. Preview texture is capped at 2048px on the long edge; export re-decodes full resolution.
- **Gallery:** justified rows at real ratios (`justifyRows` in `cropmath.js`), 2px gaps, `object-fit:cover` inside a card sized to the photo's shown aspect, 2px radius. Never use a square-crop grid.
- **Album tiles:** up to 3 thumbs side by side at real ratio (`object-fit:contain`) on `--bg-2`.
- **Filmstrip and filters:** 56px tall thumbs at real ratio; filter tiles are 1:1 previews rendered with the same GL engine.
- **Loading:** `--bg-2` ground until the thumbnail arrives, so nothing jumps.
- **Edge fade:** the rail takes the photo's right-edge color mixed with `--bg` (`--edge-soft`), so the photo seems to bleed into the tools. Keep the mix with `--bg` so text contrast holds.
- **Filenames** are always `--code` blue, 11–12px, on a `--scrim` gradient when over a photo.

## Overlays on photos

Only white: the crop dim, grid and L-brackets, the text gizmo, the selection checkbox, the `.edited` dot (accent) and the `.nm` caption. Keep every overlay legible on both a white and a black photo (that is what `--scrim`, the dim and 1px dark outlines are for).

## Brand assets

| File | Rule |
|---|---|
| `assets/logo.svg` | Brackets `#f19e4b`, cursor `#ffffff`, transparent ground, 24×24 viewBox. |
| `assets/favicon.svg` | Logo on a `#292c33` square. |
| `assets/demo.gif` | A real run: new album, import, one slider, crop, export. Recorded at 1440 wide on the real UI with real photos, ≤ 5 MB. Re-record when the look changes. |
| `docs/design/*.png` | Output of `scripts/screenshots.mjs`; regenerate after any visual change. Not hand-edited. |

## Sample photos for demos and tests

Real photographs with strong, varied color (golden hour, forest, night city, desert, portrait), landscape and portrait mixed so justified rows and letterboxing are exercised. No stock-photo watermarks, faces of identifiable strangers, or AI images presented as real.
