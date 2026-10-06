# Tokens

Source of truth: `:root` in `styles.css`. Mirrors: `theme-color` in `index.html`, `assets/logo.svg`, `assets/favicon.svg` (they must hold the same hex values), and the swatches in `styleguide.html`. Change one, change all.

## Color

Contrast is WCAG 2.x against `--bg` (#292c33) unless noted.

| Token | Value | Use | Contrast |
|---|---|---|---|
| `--bg` | `#292c33` | Terminal background: the whole app, stage, bars, rail default. | n/a |
| `--bg-2` | `#373737` | The bar behind a user message: hover and selected rows, toast, menu, active chip, focused album name. | n/a |
| `--ink` | `#ffffff` | Text, block cursor, slider thumb. | 14.0 |
| `--muted` | `#999999` | Secondary lines, hints, inactive rows. | 4.9 (the minimum allowed text; only 4.2 on `--bg-2`, so never for essential text there) |
| `--rule` | `#888888` | Full-width hairline around prompt boxes and under top bars. | 3.9 (UI line) |
| `--line` | `rgba(255,255,255,.10)` | Rare soft divider (the privacy notice, styleguide sections). | decorative |
| `--track` | `rgba(255,255,255,.14)` | Slider track. | decorative |
| `--hover` | `rgba(255,255,255,.06)` | A hover or selected wash on top of `--bg-2` (menu active row, toast action). | decorative |
| `--accent` | `#f19e4b` | Primary button text, changed slider value, active chip chevron, spinner, toast bullet, edited dot, focus ring. | 6.5 |
| `--accent-2` | `#f4ba73` | Hover for accent items, busy toast text. | 8.1 |
| `--mode` | `#f7ce46` | Active editor tab `❯`, select-mode `❯`, active compare toggle, privacy warning bullet. Nowhere else. | 9.2 |
| `--code` | `#a4cbfa` | Photo filenames only (`#edName`, `.nm`). | 8.3 |
| `--danger` | `#ff6b80` | Delete hover, disabled-row reasons, errors. | 5.1 |
| `--scrim` | `rgba(0,0,0,.6)` | Gradient behind a photo name on a card. | n/a |
| `--veil` | `rgba(41,44,51,.72)` | Photo-to-photo arrows over the stage (`--bg` at 72%). | n/a |
| `--check` | `rgba(0,0,0,.35)` | Unselected checkbox ground over a photo. | n/a |
| `--crop-dim` `--crop-edge` `--crop-grid` `--white` | black 55% · white 90% · white 35% · `#fff` | Crop overlay and text gizmo only. | n/a |
| `--edge-soft` | set by JS | The photo's right-edge color mixed with `--bg`; paints the rail and the fade. Never set it in CSS. | n/a |

**Why this palette.** Sampled from a real Ghostty window running Claude Code, so the app reads as a familiar terminal. A flat blue-gray ground makes photos pop without a frame, and the single orange accent gives action and change one voice. Yellow (`--mode`) is a rarer second signal for "you are in a mode", and the blue `--code` is borrowed from terminal paths, which is what filenames are.

**Don't:** use `--accent` for decoration or links, invent tints (`#333` etc.), put `--mode` on anything but the listed uses, use `--danger` for non-destructive emphasis.

### Why dark only
1. Editing judges the photo's tones; a bright UI shifts perceived exposure and contrast.
2. The brand is a terminal, so a light version would be a second brand to design and QA.
3. Sessions are short and task-based. Revisit only as a separate token set on `:root[data-theme="light"]`, never ad hoc.

## Typography

| Family | Weights | Source |
|---|---|---|
| JetBrains Mono (`--font`, fallback `ui-monospace, "SF Mono", Menlo, monospace`) | 400, 500, 700 | Google Fonts, with `preconnect` links in `<head>` |

| Size | Line height | Use |
|---|---|---|
| 22 / 700 | 1.4 | Titles: `.title`, `.album-name` |
| 14 / 400 | 1.4 | Body, buttons, tabs, drop hint |
| 13 | 1.4 | Toast, menu rows, notice title |
| 12 | 1.4 to 1.5 | Labels, sliders, chips, crumb, meta |
| 11 | 1.4 | Captions: album meta, `.nm`, hints, filter names |

The brand word is 500. Nothing else is bold. No uppercase, no tracking, `font-variant-numeric: tabular-nums` on every number that can change (slider values, counts, progress).

## Spacing and size

| Token | Value |
|---|---|
| `--s1` … `--s6` | 4 / 8 / 12 / 16 / 24 / 32 px |
| `--bar` | 52px (top bars) |
| `--target` | 44px (minimum touch target) |
| View max-width | 1200px, padding `--s5` (`--s4` below 600px) |

## Shape and depth

| Rule | Value |
|---|---|
| Radius | 0, except 2px on photo thumbs / gallery cards and the 50% `.edited` dot |
| Shadows | none, except the crop dim `0 0 0 9999px var(--crop-dim)` |
| Outlines | 1px accent focus ring; 2px accent active filmstrip / filter / selected card |

## Motion

Tokens in `:root`: `--ease-out` `cubic-bezier(.2,.8,.2,1)`, `--dur-fast` .12s, `--dur-med` .16s, `--dur-slow` .38s. Never write a raw duration or curve in a rule.

| Value | Use |
|---|---|
| `blink 1s steps(1) infinite` | Block cursor, top-bar logo cursor |
| `--dur-fast` | Hover/press color changes, card actions, nav arrows, slider thumb, toast exit |
| `--dur-med` | View enter (fade + 6px rise), tab panel fade, menu open, toast enter, thumb fade-in, canvas fade on photo switch, crop handles, inspect zoom, crop dim |
| `--dur-slow` | Crop settle, card hover zoom |
| 80ms per frame | Braille spinner (JS) |

Animate opacity and transform only. `prefers-reduced-motion` kills all of it (global rule at the end of `styles.css`).
