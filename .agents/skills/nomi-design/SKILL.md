---
name: nomi-design
description: Claude Code × Ghostty design system for Nomi (JetBrains Mono, terminal colors, glyphs as structure, selection chevrons, block cursors, photo-first editor). Use it whenever you touch index.html or styles.css, or add any UI markup or CSS.
---

# nomi-design

Nomi looks like Claude Code running in Ghostty: one terminal background, monospace text, one orange accent, and transcript glyphs doing the structural work that panels and borders would do elsewhere. The photos are the only other saturated color on screen.

## Tokens (in `:root` only; never hardcode colors elsewhere)
Sampled from the user's Ghostty + Claude Code window:
- `--bg:#292c33` terminal background; the whole app, including stage and top bars.
- `--bg-2:#373737` the bar behind the user's own message. Use it for hover/selected rows, the toast, the active chip and the focused album-name input.
- `--ink:#ffffff` text · `--muted:#999999` secondary lines ("Searched for 1 pattern…") and hints.
- `--rule:#888888` the full-width hairline around the prompt box (top bars, prompt boxes).
- `--line:rgba(255,255,255,.10)` subtle divider, only if truly needed · `--track:rgba(255,255,255,.14)` slider track.
- `--accent:#f19e4b` the Claude Code spinner star (sampled color only; never use that glyph) · `--accent-2:#f4ba73` spinner/shimmer text, used for hover on accent items.
- `--mode:#f7ce46` the "⏵⏵ auto mode on" line. Use it ONLY for the active editor tab's `❯`.
- `--scrim` photo-name gradient. Crop overlay: `--crop-dim` `--crop-edge` `--crop-grid` `--white` (unchanged).
- Spacing `--s1..--s6` = 4/8/12/16/24/32 · `--bar:52px` · `--target:44px`.
- `--code:#a4cbfa` paths / inline code in the terminal → photo filenames (`#edName`, gallery `.nm`) only.
- `theme-color #292c33`; favicon is `assets/favicon.svg` (the logo on a `#292c33` square).

## Font and type
- `--font:"JetBrains Mono",ui-monospace,"SF Mono",Menlo,monospace` (Ghostty's default), loaded from Google Fonts at 400/500/700 with preconnects.
- 14 base · 12 labels · 11 captions · 13 toast · 22 titles. Line-height 1.4.
- No bold except titles (700); the brand word is 500. No uppercase, no letter-spacing. Numbers use `tabular-nums`.

## Glyph vocabulary (sparing and consistent)
- **Logo** (`assets/logo.svg`, inlined in `.brand`): four accent crop L-brackets (the crop tool's handles) framing a white block cursor. Stroke 2.25 on a 24 grid, square caps, no radius. The cursor blinks in the topbar only. Never use the Anthropic/Claude ✻ spark.
- `●` white: before primary headings (page title, album tile names, empty-state first line). Muted `●` for rail group titles (`● aspect`, `● rotate`). Accent `●` before toast text.
- `⎿` muted: before secondary/meta lines (`#albumMeta`, the albums subline, the empty-state second line).
- `❯`: the prompt and selection chevron.
- Block cursor: `<span class="cursor">`, 8×16 `--ink`, `blink 1s steps(1) infinite`. Only at the end of a prompt line.
- When the text comes from JS, draw glyphs with `::before` so JS keeps setting plain text. Use `white-space:pre` on the pseudo so the trailing space survives.

## Selection = the chevron
- A chosen row gets `❯ ` and white text; the others are muted with an invisible `❯ ` (`color:transparent`) of the same width, so nothing shifts. No underlines.
- Editor tabs (`adjust` / `crop`): active chevron in `--mode`.
- Aspect `.chip`s: borderless text; active chevron in accent + `--bg-2` background; hover `--bg-2`.
- `.album-card`: hover turns the name accent (bullet stays white).

## Buttons are terminal text, not boxes
- `.btn`: transparent, muted, no border, radius 0, min-height 44; hover `--bg-2` + ink.
- `.btn.primary`: accent text wrapped in `::before "[ "` / `::after " ]"` → `[ Done ]`, `[ New album ]`, `[ Import photos ]`. Hover `--bg-2` + `--accent-2`.
- `#btnDownloadAlbum` reads `↓ album.zip`; `#btnDuplicate` and Reset are plain `.btn`.
- Focus: `:focus-visible` 1px accent outline, offset 2.

## Prompt box, caret, thumbs
- The Claude Code input is framed by full-width `--rule` hairlines above and below, with `❯ ` and a block cursor.
- `#dropHint`: `--rule` top + bottom, `❯ drop images anywhere · or click to browse` muted + `.cursor`; hover makes the text ink. Keep id, `role="button"`, `tabindex`.
- `#albumName` lives in `.prompt-line` (`.chev` + input), 22px/700 white. Hairlines appear only on `:focus-within`; the focused input gets `--bg-2`.
- Carets: `input,textarea{caret-color:var(--ink);caret-shape:block}`.
- Sliders: 2px `--track`, accent fill between `--lo`/`--hi` (JS-set %), thumb is a block cursor (8×16, radius 0, ink; accent on hover/active). Name muted, value ink; `.changed` → value accent, name ink. Rows ≥44px, 16px apart.
- Toast: `--bg-2` bar, radius 0, ink 13px, accent `●`, bottom-center.

## No panels
- No bordered cards, shadows (except the crop dim), pills or radii (except 2px thumbs and the round `.edited` dot).
- Hairlines are `--rule` and only for top bars and prompt boxes.

## Layout
- `.topbar` 52px, `--rule` bottom: logo + `nomi`, muted `#crumb`, `#btnDownloadAlbum` right. Hidden while the editor is open.
- Albums view: `● albums` title, `⎿` subline, actions; `.album-grid` tiles with up to 3 real-ratio thumbs. Empty state is a transcript: `● no albums yet` / `  ⎿ create one…` / `❯ █`.
- Album view: prompt-line title, `⎿` meta, `#dropHint`, then the justified gallery: `.photo-grid` > `.photo-row` > `.photo-card`. JS sets row heights and card widths from each photo's ratio; CSS never sizes them. Overlays: `.nm` ink on `--scrim`, `.dup` `⧉ duplicate` on `--bg-2` (accent hover), `.edited` accent dot.
- **Import:** `<label class="btn primary file-btn">Import photos<input id="fileInput" type="file" …></label>`; the input is absolute, `inset:0`, `opacity:0`, `font-size:16px`. Never `hidden`, `display:none`, a 1px clip or `for=`.

## Editor (photo first)
- `100dvh` grid: 52px `.ed-top` (Cancel · centered name · Duplicate · Reset · `[ Done ]`), `.stage` 1fr, `.rail` `clamp(280px,28vw,360px)`.
- **The photo is always letterboxed in full.** JS sizes `#glCanvas` in px; CSS only sets `max-width/max-height:100%; flex:none`.
- **Fade:** JS sets `--edge-soft`; the rail background is `var(--edge-soft,var(--bg))`; `.stage::after` is a 140px eased gradient to it (z 1). In `.editor.cropping` the stage-wrap pads right 140px and the fade sits above the dim (z 3).
- Rail: chevron tabs, then sliders or the crop panel (`● aspect` chips, `● rotate`, straighten, 11px muted hint), then `#filmstrip` at `margin-top:auto` (56px, opacity .6, active 2px accent outline).
- **Crop overlay:** `#cropLayer` absolute z 2 over the canvas; `#cropBox` dims with `0 0 0 9999px var(--crop-dim)` + 1px white outline; `.crop-grid` 3×3 at 35% white; `.h.tl|tr|bl|br` 44×44 hit areas drawing white 3px L-brackets (22×22), `touch-action:none`.

## Responsive and motion
- Below 960px: single column, stage 58dvh on top, rail below, fade turns vertical.
- Below 600px: insets 16, tighter button padding in `.ed-top`, gallery rows target 140px.
- `prefers-reduced-motion`: no transitions, no cursor blink.

## Checklist
- [ ] Every color is a `:root` token from the list above; no stray hex.
- [ ] `--mode` yellow appears only on the active tab chevron.
- [ ] Whole UI is JetBrains Mono; only titles are bold; no uppercase or tracking.
- [ ] Glyphs follow the vocabulary: logo (brackets + cursor) as brand, `●` headings, `⎿` meta, `❯` prompt/selection.
- [ ] Selected rows use the chevron with an invisible same-width prefix on the others.
- [ ] Buttons are text: default muted, primary `[ … ]` in accent; hover `--bg-2`.
- [ ] Prompt boxes use `--rule` hairlines top and bottom and a block cursor or block caret.
- [ ] Slider thumbs are 8×16 blocks; fill between `--lo`/`--hi` is accent.
- [ ] No panels, shadows (except crop dim) or radii (except 2px thumbs, edited dot).
- [ ] Spacing is 4/8/12/16/24/32 and every target is ≥44px.
- [ ] Every DOM id JS uses exists; the import input is a real stretched control.
- [ ] Canvas never CSS-stretched; fade seamless; crop overlay has dim, grid, L-brackets.
- [ ] Works at 960 and 600 with no horizontal scroll; reduced motion stops the blink.
- [ ] Export choices use the `#exportMenu` selection list (`❯` active row, disabled rows show the reason in `--danger`); destructive saves confirm inline via the toast action, never `confirm()`.
