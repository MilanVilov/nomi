---
name: nomi-design
description: nomi's design language, "Claude Code running in Ghostty" (JetBrains Mono, terminal colors, glyphs as structure, one orange accent, photo-first editor). Load this BEFORE building or changing any nomi UI, including index.html, styles.css, new views, buttons, menus, toasts, sliders, empty/error/busy states, microcopy, the logo, README or demo visuals, and screenshots. Also load it when reviewing UI, or when someone mentions colors, fonts, spacing, "make it look nicer", the styleguide or the brand.
---

# nomi design language

nomi should feel like Claude Code running in Ghostty: one terminal background, monospace text, one orange accent, and transcript glyphs (`●` `⎿` `❯` `█`) doing the structural work that panels and borders do elsewhere. The user's photos are the heroes and the only other saturated color on screen. Everything else stays quiet and text-shaped.

**Living reference:** `styleguide.html` renders every token and component from the real `styles.css`. **Tokens:** `:root` in `styles.css`. **Screenshots:** `node scripts/screenshots.mjs` (see `references/layout-and-motion.md`).

## Six principles

1. **The photo is the hero.** Color comes from photographs. The chrome uses only `--bg`, `--bg-2`, `--ink`, `--muted`, `--rule` and the accent family. The editor always shows the whole photo, letterboxed, never CSS-stretched.
2. **Text is the interface.** Buttons are words, selection is a `❯`, headings are a `●`, meta lines hang off `⎿`. No panels, cards, pills, shadows or icon libraries.
3. **One accent, used sparingly.** `--accent` orange means "primary, changed, selected". `--mode` yellow appears only on the active editor tab chevron, the select-mode chevron, the busy-warning bullet and the active compare toggle. `--danger` is only for destructive hover and error reasons.
4. **Quiet until it matters.** One `[ primary ]` per view. Everything else is muted text that lights up on hover.
5. **Honest and local.** Nothing leaves the tab, and the UI says so plainly. Tell users what is kept in memory and what is lost on reload (see `references/voice-and-copy.md`).
6. **Zero dependencies.** One font (JetBrains Mono, 3 weights), plain CSS, no UI library, no build step. Every id that JS uses exists in the HTML.

## Core rules (non-negotiable)

- **Tokens only.** Every color is a `:root` token. No hex or rgba outside `:root` and the Text tool's user-pickable colors. If you need a new shade, add a token and document it in `references/tokens.md` and `styleguide.html`.
- **Type:** JetBrains Mono everywhere. Weights 400 body, 500 brand word, 700 titles only. Sizes 22 / 14 / 13 / 12 / 11. No uppercase, no letter-spacing. Numbers use `tabular-nums`.
- **Shape:** radius 0 everywhere except 2px photo thumbs and the round `.edited` dot. No box shadows except the crop dim.
- **Lines:** hairlines are `--rule` and only for top bars and prompt boxes. `--line` is a rare soft divider.
- **Selection is the chevron:** chosen = `❯ ` + white text; others muted with an invisible same-width `❯ ` (`color:transparent`) so nothing shifts. No underlines, no pills.
- **Targets:** every interactive element is at least 44px tall (`--target`), except the 32px photo-card actions and the 24px color swatch.
- **Focus:** keep `:focus-visible` 1px `--accent` outline, offset 2px. Never remove it without an equal replacement.
- **No browser dialogs.** Never `alert()` / `confirm()` / `prompt()`. Use the toast (with an inline action for undo) or the `#exportMenu` list.
- **Dark only.** There is no light theme (reasoning in `references/tokens.md`). Don't add `prefers-color-scheme` branches.
- **Lowercase voice.** Status, toasts, meta, tabs and secondary buttons are lowercase. Only primary `[ Buttons ]`, the editor's `Cancel` / `Duplicate` / `Reset` and photo names keep their own casing. See `references/voice-and-copy.md`.

## Do / don't at a glance

| Do | Don't |
|---|---|
| `[ Import photos ]` in accent, hover `--bg-2` | A filled orange rounded button |
| `● albums` / `⎿ session-only · nothing leaves this tab` | A bold H1 with an underline and a gray subtitle |
| `❯ drop images anywhere` between two `--rule` hairlines | A dashed dropzone box with a cloud icon |
| Toast: `● deleted 3 photos  undo` | `confirm("Delete 3 photos?")` |
| Photo name in `--code` blue on a `--scrim` | White labels on a pill |
| Slider thumb as an 8×16 block cursor | A round knob with a shadow |
| `⠹ exporting 8/24 · IMG_2041.jpg` (braille spinner) | A spinning SVG or a progress bar |

## Reference files (read the one you need)

- `references/tokens.md`: every color, type size, spacing and motion value, with contrast ratios and the reasoning (palette, font, why dark only).
- `references/components.md`: markup and CSS recipe for every component: glyphs, logo, buttons, tabs, chips, prompt box, sliders, toast, menu, notice, albums, gallery, select bar, filters, crop, text gizmo.
- `references/layout-and-motion.md`: page skeletons, the editor grid, responsive breakpoints, motion, and how to take and read screenshots.
- `references/voice-and-copy.md`: tone rules and microcopy for every state (empty, busy, success, error, privacy notices).
- `references/imagery.md`: how photos are shown (letterbox, justified gallery, thumbs, edge fade), the logo, favicon, and demo assets.
- `references/share-and-docs.md`: README, meta tags, theme color, social image and demo gif rules.

## Before you ship UI (checklist)

1. [ ] Only `:root` tokens (grep your diff for `#[0-9a-f]{3,6}` and `rgba?\(` outside `:root`).
2. [ ] You reused an existing class. A new component is added to `styleguide.html` and `references/components.md`.
3. [ ] One `[ primary ]` in the view, visible without scrolling at 390px.
4. [ ] Glyphs follow the vocabulary: `●` headings, `⎿` meta, `❯` prompt and selection, block cursor only at the end of a prompt line.
5. [ ] Selected rows use the chevron with an invisible same-width prefix on the others.
6. [ ] Copy is lowercase, plain and specific, and follows `voice-and-copy.md`.
7. [ ] Keyboard: everything reachable, visible focus, logical order. Inputs have `aria-label` or a label. Decorative glyphs have `aria-hidden="true"`.
8. [ ] Contrast: `--muted` on `--bg` is the lowest allowed text. Don't put `--muted` on `--bg-2` for anything essential.
9. [ ] 960px and 600px breakpoints work with no horizontal scroll, including the phone editor top bar at 360px.
10. [ ] Every DOM id used by JS exists; the import input is a real stretched `<input type="file">` (never `hidden`, `display:none` or `for=`).
11. [ ] Canvas never CSS-stretched; edge fade seamless; crop overlay has dim, grid and L-brackets.
12. [ ] `prefers-reduced-motion` stops the cursor blink and transitions.
13. [ ] `node tests/run.js` passes, and `node scripts/screenshots.mjs` shows no `!` warnings and the screenshots look right at 390 and 1440.

## Naming

The name is **nomi**, always lowercase, also at the start of a sentence and in titles. The mark is the crop-bracket logo with a block cursor, never the Anthropic / Claude ✻ spark.
