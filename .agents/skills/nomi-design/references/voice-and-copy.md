# Voice and copy

nomi talks like a terminal that respects you: short, lowercase, specific, no hype. Never "oops", "awesome" or exclamation marks. No emoji.

## Rules

1. **Lowercase** for status, toasts, meta lines, tabs, chips-with-words and secondary buttons. Capital first letter only for the primary `[ Button ]`, the editor's `Cancel` / `Duplicate` / `Reset` / `Done`, photo and album names, and the filter and font names.
2. **Say the outcome with a number:** `added 5 photos`, `saved 12 photos to zip`, not `success`.
3. **Say what is lost, and how to avoid it.** Everything is in memory. Export before leaving.
4. **Errors say what happened and what to do:** `webgl2 is not available in this browser` plus a hint when known. Show the real `err.message` when it helps.
5. **No question marks or dialogs.** Destructive actions happen immediately and offer `undo` in the toast.
6. **One idea per line.** Details hang off `⎿`.
7. Use `·` (middle dot) as the separator, `→` for steps, `…` for ongoing work, `“ ”` around folder names, a real minus `−` for negative values.
8. English only for now. If localized later, keep both strings next to each other in one `copy` object per module, and keep the lowercase rule per language.

## Microcopy by state

| State | Copy |
|---|---|
| Albums title / sub | `● albums` / `⎿ session-only · nothing leaves this tab` |
| Empty albums | `● no albums yet` / `⎿ create one to start. everything vanishes on reload.` / `❯ █` |
| New album | primary `[ New album ]` |
| Album meta | `⎿ 12 photos` (`· 3 edited` when relevant) |
| Drop zone | `❯ drop images anywhere · or click to browse` (phones: `tap to add photos`) |
| Importing | busy `importing 3/12 · IMG_2041.jpg` then `added 12 photos` |
| Import skipped | `added 10 photos · skipped 2 (not images)` (stays 10s) |
| Delete | `deleted IMG_2041.jpg` + `undo`; then `restored IMG_2041.jpg` |
| Delete (photo from an opened folder) | `removed IMG_2041.jpg from the album · the file is still on disk` + `also delete file` `undo` (12s; ignoring it keeps the file); then `deleted IMG_2041.jpg from disk` |
| Duplicate | `duplicated as IMG_2041 copy.jpg` |
| Select mode | `select` toggles to `selecting`; bar: `❯ 2 of 5 selected` · `select all` · `[ export 2 ]` · `delete` · `cancel` |
| Editor hint (crop) | `drag the box, its corners or its sides · it settles to fill the view · ⌘Z to undo` |
| Compare | `◐ original` toggle; badge `● original` |
| Exporting | busy `exporting 8/24 · IMG_2041.jpg`, then `saved 24 photos to zip` |
| Export menu | `export 24 photos` / `save to folder` / `download zip · full-res copies · originals untouched` |
| Disabled menu row | reason in danger: `open photos with “open folder” first` |
| Folder saved | `saved 12 photos in “trip” · originals kept in .nomi-originals` |
| Nothing to save (all saved photos match the disk) | menu hint `nothing changed since last save` (disabled row; `nothing edited yet` before the first save) |
| Photo can't be decoded when navigating | `could not open IMG_2041.jpg` |
| Permission | `no permission to write to “trip”` |
| Unsupported | `webgl2 is not available in this browser` |
| Help | `new album → import photos → click a photo → done → export` |

## Privacy notice (keep it accurate)

```
● heads up: everything lives in this tab's memory (RAM)
  ⎿ your original files are only read, never changed, unless you choose export → save to folder …
  ⎿ reloading or closing the tab loses all albums and edits. export before you leave.
  ⎿ a few hundred photos is fine, but a zip of 100+ full-res photos can need gigabytes of RAM …
```
If the storage or export behavior changes, update this notice, `README.md` and `docs/features.md` in the same change.

## Naming things

Tabs: `adjust · filters · crop · text`. Aspect chips: `Free · Original · Square · 4:3 · 3:2 · 16:9`. Slider names are Apple Photos terms (Exposure, Brilliance, Highlights, Shadows, Contrast, Brightness, Black Point, Saturation, Vibrance, Warmth, Tint). Keep them.
