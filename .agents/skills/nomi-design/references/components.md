# Components

All components are plain CSS classes in `styles.css`; markup is in `index.html` (static) or built by JS (`src/app.js`, `src/editor/*.js`). See each one live in `styleguide.html`.

Rules for every component:
- Reuse before you create. Extend a class with a modifier (`.btn.primary`, `.slider.changed`) instead of a one-off copy.
- When the text comes from JS, draw glyphs with `::before` so JS keeps setting plain text. Use `white-space:pre` on the pseudo-element so the trailing space survives.
- A new component gets a specimen in `styleguide.html`, a section here, and a line in the SKILL.md checklist if it adds a rule.

## Glyphs

| Glyph | Where | Color |
|---|---|---|
| `●` | Before primary headings (page title, album tile names, empty first line) | `--ink` |
| `●` | Before rail group titles (`● aspect`) | `--muted` |
| `●` | Before toast text, original badge | `--accent` |
| `●` | Privacy notice bullet (`.warn`) | `--mode` |
| `⎿` | Before meta lines (`.sub`, `.t-sub`, `.elbow`) | `--muted` |
| `❯` | Prompt line, selection, select bar | `--muted`; active: ink / `--accent` / `--mode` |
| `█` | Block cursor `<span class="cursor">`, 8×16, blinks. Only at the end of a prompt line | `--ink` |
| `⠋⠙⠹…` | Busy spinner, JS-driven at 80ms | `--accent` |
| `↶ ↷ ◐ ⟲ ⧉ ✕ ‹ › ↓` | The only other symbols (history, compare, rotate, duplicate, delete, nav, export). Plain text, no icon font. | inherit |

Never use the Anthropic / Claude ✻ spark.

## Logo (`assets/logo.svg`, inlined in `.brand`)

Four accent crop L-brackets (the crop tool's handles) framing a white block cursor. 24 grid, stroke 2.25, square caps, no radius. Brackets `#f19e4b`, cursor `#ffffff`. The cursor blinks (`.logo-cursor`) in the top bar only; `logo.svg`, favicon and README are static. The favicon is the logo on a `#292c33` square.

## Buttons (`.btn`)

```html
<button class="btn primary">New album</button>   <!-- renders [ New album ] in accent -->
<button class="btn ghost">open folder</button>
<button class="btn ghost danger">delete</button>
<label class="btn primary file-btn">Import photos<input type="file" id="fileInput" accept="image/*" multiple></label>
```
- Transparent, muted, no border, radius 0, min-height 44. Hover: `--bg-2` + ink (eased `--dur-fast`); pressed dims.
- `.primary`: accent text with `::before "[ "` / `::after " ]"`. Hover: `--bg-2` + `--accent-2`. One per view.
- `.danger`: turns `--danger` on hover only. Destructive actions are undoable by toast, not confirmed by dialog.
- `:disabled`: opacity .4, no pointer events.
- Import: the real file input is absolute, `inset:0`, `opacity:0`, `font-size:16px` over the label. Never `hidden`, `display:none`, a 1px clip or `for=`.
- Busy: `#btnDownloadAlbum.busy` shows the spinner in accent-2.

## Tabs and chips (selection)

```html
<button class="tab active" role="tab" aria-selected="true">adjust</button>
<button class="chip active">Original</button>
```
- Both reserve an invisible `❯ ` so the active one can show the chevron without shifting layout.
- Tab: active text ink, chevron `--mode`. Chip: active `--bg-2` background, chevron `--accent`; hover `--bg-2`.
- Keep `role="tablist"`, `role="tab"`, `aria-selected` in sync (JS does).

## Prompt box (`.drop`, `.prompt-line`, `.tx-input`)

- `.drop` (`#dropHint`): `--rule` hairline top and bottom, `❯ ` muted text and a `.cursor`; hover turns the text ink. Keep `id`, `role="button"`, `tabindex="0"`. Two spans (`.long` / `.short`) swap copy at 600px.
- `.prompt-line` holds `.chev` + `.album-name` (22px / 700). Hairlines appear only on `:focus-within`; the focused input gets `--bg-2`.
- `.tx-input` wraps the text-tool textarea with the same hairlines.
- Carets: `input,textarea{caret-color:var(--ink);caret-shape:block}`. `::selection` is accent on `--bg`.

## Sliders (`.slider`)

```html
<label class="slider changed"><span><i>Brilliance</i> <b>+40</b></span><input type="range" min="-100" max="100" value="40" style="--lo:50%;--hi:70%"></label>
```
- Row min-height 44, 16px apart. Name muted, value ink; `.changed` flips to value accent and name ink.
- Track 2px `--track`; fill between `--lo` and `--hi` (JS sets percentages from the default to the value) in accent.
- Thumb: 8×16 block, radius 0, ink; `--accent-2` on hover; accent and 1.25x while dragging. Double-click resets.
- Values use `tabular-nums`; negative numbers use a real minus `−`.

## Toast (`#toast`) and busy states

- Bottom-center `--bg-2` bar, ink 13px, accent `●` bullet, one line with ellipsis, 44px high. Role `status`.
- `.toast.busy`: text `--accent-2`, bullet replaced by a braille spinner span (`.spin`). Stays until the next toast.
- Enter: rise + fade; exit: `.leaving` for 140ms (JS). `.toast-action` (inline button, accent) carries undo. Default lifetime 2.6s; errors 8–10s.
- Toasts with actions wrap: message on top and actions below on phones, one row on desktop; the bullet lives on `.toast-msg`. Use `extra: [{ label, run }]` for a second action (delete-from-disk question + undo, 12s).
- API: `toast(msg, { busy, action: { label, run, expire }, extra: [], ms })` in `app.js`.

## Export menu (`#exportMenu`)

A Claude Code selection list on `--bg-2` with a `--rule` outline. `.menu-title` muted 12px, `.menu-item` with `.mi-label` (chevron slot) and `.mi-hint` (11px muted). `.active` = `--hover` wash + accent chevron. `[aria-disabled="true"]` dims the row and shows the reason in `--danger`. Opens under `#btnDownloadAlbum`, clamped inside the viewport.

## Privacy notice (`.notice`)

`--line` hairlines top and bottom; `.t-line` with a `--mode` `●`, then `.t-sub` lines with `⎿`. Max 88ch. Use it for anything the user must know before losing data.

## Albums (`.album-grid`, `.album-card`)

Tiles in an auto-fill grid (min 220px, 150px on phones). `.thumbs` is a flex row of up to 3 real-ratio thumbs (2px radius) on `--bg-2`. Name `● ` white, 14px, ellipsis; hover turns the name accent. `.meta` is 11px muted.

## Gallery (`.photo-grid` > `.photo-row` > `.photo-card`)

JS sets row heights and card widths from each photo's ratio (justified rows, 2px gap); CSS never sizes them. Overlays: `.nm` filename in `--code` on `--scrim` (hover), `.card-actions` `⧉` duplicate / `✕` delete on `--bg-2` (hover or focus; always visible on touch), `.edited` accent dot top-left. `.just-edited` is the "you were here" cue after Done / Cancel: JS scrolls the card into view (centred when off-screen) and adds a 2px `--accent` outline (`outline-offset:-2px`) that fades out over 1.4s via the `found` keyframes, then drops the class; relayouts resume it via a negative `animation-delay`. Reduced motion: no fade, the outline just disappears.

## Select bar (`.select-bar`)

Sticky, `--rule` hairlines, `❯` in `--mode`, `.sel-count` pushed left, then `select all`, `[ export selected ]`, `delete`, `cancel`. In `.selecting` mode cards show a 20px checkbox (`✓` on accent when selected) and a 2px accent outline.

## Filters (`.filter-row` > `.filter`)

3-column grid of square thumbs (2-line name below, `❯` slot). Active: ink name, accent chevron, 2px accent outline. Below 960px it becomes a horizontal strip of 96px tiles. `.filter-amount` is a slider shown only for the active filter.

## Editor overlays

- **Crop:** `#cropLayer` over the canvas; `#cropBox` dims with `0 0 0 9999px var(--crop-dim)` and a 1px white outline; `.crop-grid` 3×3 at 35% white; `.h.tl|tr|bl|br` are 44×44 hit areas drawing white 3px L-brackets; `.h.t|r|b|l` are 44px-thick strips along each side between the corner zones (corners win) drawing a short 28×3px white bar centred on the edge (iOS Photos style), with `ns-resize`/`ew-resize` cursors; all handles are `touch-action:none` and `scale(var(--inv))` so they stay screen-sized while zoomed. Settled crop makes the cut area solid `--bg`.
- **Text gizmo:** dashed `--crop-grid` quad per text, solid for the selected one; 10px white square scale handles, accent 12px pin handles, a `↻` rotate handle on `--bg-2`.
- **Nav arrows:** `‹ ›` 44×72 on `--veil`, visible on stage hover, always on touch, hidden while cropping.
- **Compare:** `◐ original` toggle (`aria-pressed`); pressed = `--bg-2` + accent glyph; `.orig-badge` top-left of the stage.
- **Filmstrip:** 56px tall thumbs, opacity .6, active 2px accent outline, `margin-top:auto` in the rail.
