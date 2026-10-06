# Layout, responsive rules, motion and screenshots

## Views

One `<body>`, three `<main class="view">` sections toggled with `.hidden`, plus the shared top bar.

**Albums**
```
.topbar        logo + nomi · crumb "albums" · (export hidden)
.page-head     ● albums / ⎿ session-only · nothing leaves this tab · [ New album ] open folder  How it works
.notice        ● heads up … ⎿ detail lines
.album-grid    tiles   (or .empty transcript: ● no albums yet / ⎿ create one… / ❯ █)
```
**Album**
```
.topbar        … crumb "albums / Name" · ↓ export
.page-head     ❯ [name input] / ⎿ 12 photos · [ Import photos ] select  ‹ albums
#dropHint      ❯ drop images anywhere · or click to browse █
.select-bar    (select mode only)
.photo-grid    justified rows
```
**Editor** (the top bar is hidden; `body:has(#viewEditor:not(.hidden))`)
```
.ed-top   Cancel · ↶ ↷ ◐ original · [filename] · Duplicate  Reset  [ Done ]
.stage    photo letterboxed in full · edge fade · ‹ › arrows · crop/text layers
.rail     tabs · panel (sliders | filters | crop | text) · filmstrip
```

## Grid and spacing

- Page frame: `.view` max-width 1200, padding 24 (16 on phones). Gaps come from `--s1…--s6`: 4 inside a glyph group, 8 between buttons, 12 inside a row, 16 between rows, 24 between blocks, 32 between sections.
- Editor: `100dvh` grid, `52px` bar, stage `1fr`, rail `clamp(280px, 28vw, 360px)`. Always `minmax(0,1fr)` for single-column tracks so wide children can't stretch the page.
- **The photo is always letterboxed in full.** JS sizes `#glCanvas` in px; CSS only sets `max-width/max-height:100%; flex:none`.
- **Fade:** JS sets `--edge-soft` from the photo's right edge; the rail background is `var(--edge-soft, var(--bg))`; `.stage::after` is a 140px eased gradient into it (z 1). In `.editor.cropping` the stage pads right 140px and the fade sits above the dim (z 3).

## Breakpoints

| Width | Changes |
|---|---|
| ≥ 960 | Editor is two columns (stage + rail). |
| < 960 | Editor is one column: stage 58dvh on top, rail below, the fade turns vertical (32px). Filter grid becomes a horizontal strip. |
| < 600 | View padding 16, album tiles min 150px, gallery rows aim for 140px, drop hint shortens to `tap to add photos`, editor filename hidden, editor bar tightens (6px padding, 36px history buttons) so `Cancel ↶ ↷ ◐ Duplicate Reset [ Done ]` fits 360px. |

Rules: nothing scrolls horizontally at 360, 390 or 1440. No hover-only affordances (`@media (hover:none)` shows card actions and arrows). Use `100dvh`, not `100vh`. The primary action is visible without scrolling at 390px.

## Motion

Smooth, short, never bouncy. Tokens (`--ease-out`, `--dur-fast/med/slow`) are in `tokens.md`.

| Situation | Recipe |
|---|---|
| Cursor | `blink 1s steps(1) infinite` (kept off in reduced motion) |
| Hover/press on buttons, tabs, chips, filters, rows | color / background `--dur-fast`; `:active` goes `--accent-2` or dims |
| View change (albums / album) | `.view:not(.hidden)` runs `rise-in` (opacity + 6px). The editor only fades (it is measured on open) |
| Gallery cards | `img` starts at opacity 0, JS adds `.loaded` on load; first 12 new cards stagger 30ms (`--i` via inline transition-delay). Cards already shown never replay |
| Editor | `#glCanvas.photo-in` fades the new photo (JS re-adds it on open); `.rail>[role=tabpanel]` fades on tab change; crop handles fade in; filmstrip glides the current thumb to the middle |
| Sliders | thumb grows 1.25x and goes accent while dragging; value turns accent when not default; double-click resets |
| Toast | enters with `toast-in` (rise + fade); `hideToast` adds `.leaving` for 140ms, then hides |
| Menu | `rise-in` when opened |
| Select check | `pop-in` scale .6 to 1 |
| Inspect zoom / crop settle / dim | `--dur-med` / `--dur-slow` / `--dur-med` |
| Busy | braille spinner at 80ms per frame |

Enter animations hang off `:not(.hidden)`, so toggling `.hidden` is all JS has to do. Never animate layout properties. No parallax, springs, confetti or skeleton shimmer. `prefers-reduced-motion` collapses everything globally; don't override it.

## Screenshots (do this before calling UI done)

```bash
python3 -m http.server 8811 &
node scripts/screenshots.mjs                     # writes docs/design/*.png, 390 and 1440 wide
node scripts/screenshots.mjs out/ http://localhost:8811   # custom dir / URL
```
The script resolves Playwright from `NOMI_PLAYWRIGHT`, `./node_modules` or `../redsgn/node_modules` (nomi itself has zero dependencies; `npm i --no-save playwright` works too). It draws five sample photos in the page, drives the real app (new album, import, select mode, editor adjust / slider / filters / crop / text, export menu), screenshots `styleguide.html`, prints `!` for horizontal overflow and console errors, and exits with the PNGs. Open each PNG and check: no clipped buttons, chevrons aligned, rail fade seamless, accent used sparingly, nothing wraps awkwardly at 390.
Note: the editor has `overflow:hidden`, so a clipped bar will not trigger the overflow warning. Look at the image.
