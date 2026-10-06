# Share, meta and docs

nomi is a static, no-backend app, so "marketing" is the README, the page `<head>` and a demo.

## Page head (`index.html`)

- `<title>nomi · photo editor</title>` (`styleguide.html` is `nomi · styleguide`, with `robots: noindex`).
- `<meta name="theme-color" content="#292c33">` and `<meta name="color-scheme" content="dark">`.
- `viewport` includes `viewport-fit=cover`; use `env(safe-area-inset-bottom)` for fixed bottom UI (the toast does).
- Favicon: `assets/favicon.svg`. Fonts: Google Fonts JetBrains Mono 400/500/700 with `preconnect`.
- If a share image is added: 1200×630, `--bg` ground, the logo and `nomi` at left in JetBrains Mono, one transcript line (`● edit photos in your browser` / `⎿ nothing leaves this tab`), a real edited photo at right. Safe margin 64px. Add `og:title`, `og:description`, `og:image` and `twitter:card=summary_large_image` together.

## README

Structure to keep: title and one-sentence promise, the demo GIF, `How it works` (numbered, 3 steps), `Run`, a pointer to `docs/features.md`. Tone follows `voice-and-copy.md`. Mention memory-only storage in the first paragraph, because it is the product's honest limitation.

## docs/features.md

One bullet per user-visible behavior, bold lead-in naming the feature, then the rule in plain words (see existing entries). Update it in the same change as the feature.

## Keeping the system alive

- Change a token: edit `:root`, `tokens.md`, `styleguide.html`, `logo.svg` / `favicon.svg` / `theme-color` if relevant.
- Add a component: CSS in `styles.css`, specimen in `styleguide.html`, section in `components.md`.
- Visual change: run `node scripts/screenshots.mjs`, look at all PNGs at 390 and 1440, then refresh `demo.gif` if the main flow changed.
