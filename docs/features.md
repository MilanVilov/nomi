# Nomi features

Static, no backend, no account. Everything stays in this tab and is gone on reload.

## Run

```bash
python3 -m http.server 8811 --directory .
# open http://localhost:8811/index.html
```

## Flow

1. New album → name it
2. Import photos (the button opens the OS file picker; drag-and-drop anywhere also works)
3. Click a photo → **adjust** (11 Apple Photos-style sliders, double-click a slider to reset it) or **crop** (drag the box/corners, Free/Original/Square/4:3/3:2/16:9, rotate 90°, straighten ±45°)
4. Done → `↓ album.zip` (full resolution, JPEG quality 1.0 or PNG, `name-edited.ext`, uncompressed STORE ZIP)

Cancel discards the edits made since the photo was opened.

- **Zoom to inspect (adjust / filters):** click the photo to zoom in 2× at that spot (click again for more, up to 8×), drag to move around, scroll to zoom back out. Zoom resets when you switch tabs or photos.
- **Photo to photo:** ← / → in the editor, the ‹ › arrows at the photo edges, or a filmstrip click. Switching keeps the current edits (like Done) and starts a fresh undo history. A slider you tabbed to with the keyboard keeps ←/→ for itself.
- **Undo / redo while editing:** `↶ ↷` in the editor bar, or ⌘Z / ⇧⌘Z. Each settled change is one step (a whole slider drag, a crop gesture, a filter pick). History is cleared on Done or Cancel.
- **Crop settles like iOS:** about a second after you release a crop handle, the view zooms and centers the crop so it fills the stage, and the cut area becomes solid. While dragging, the cut area is dimmed so you can pull the crop back out.

- **Gallery:** justified rows (like Google Photos). Every full row spans the width exactly and photos keep their ratio, with no stretching and no empty holes. It scrolls endlessly as the album grows.
- **Import:** there's no file limit. A spinner status and the album count update as each photo lands, and photos appear in the gallery as they load. Dropped folders are read recursively. Files the browser can't decode (e.g. HEIC in Chrome) are skipped and listed in the final summary instead of showing as broken tiles.
- **Filters:** the iOS Photos set (Vivid, Vivid Warm/Cool, Dramatic, Dramatic Warm/Cool, Mono, Silvertone, Noir) with live previews and an intensity slider. They're applied in the same shader at export.
- **Save back to your folder (Chrome / Edge):** use `open folder` on the albums page instead of Import. It creates an album that mirrors that folder, so the album has no Import button or drop area; manual albums keep them, then when you're done choose `↓ export` → **save to folder**.
  - What it writes: edited photos overwrite their files in the same format. JPEG is saved at quality 0.95, and its EXIF (camera, date, GPS) is copied across with orientation reset. PNG/WebP metadata isn't kept.
  - Backups: before the first overwrite, the untouched original is copied to `.nomi-originals/`, and later saves never replace that backup.
  - Copies: duplicates are written as new files (`name copy.jpg`).
  - Skipped: unedited photos aren't rewritten. HEIC/GIF/TIFF can't be written back, so they're skipped.
  - Afterwards: the edit is baked in, so the photo starts from neutral settings.
  - Confirmation: saving asks once, inline. You pick the folder again each session; nothing is remembered.
- **Export menu:** `↓ export` (album) and `export N` (selection) both offer **save to folder** or **download zip**.
- **Select / delete:** `select` mode lets you export just the chosen photos (`Album (3 of 14).zip`) or delete them. Deleting (per photo `✕` or in bulk) shows an undo. `↓ album.zip` exports everything and shows a spinner with a count while it works.
- **Duplicate:** hover a photo and click `⧉ duplicate`, or press `Duplicate` in the editor. The copy keeps the edits, gets a `name copy.ext` name, and appears right after the original. ZIP names never collide.

## Tech

- Plain HTML + ES modules, zero npm deps. WebGL2 single-pass shader for preview (2048px cap) and full-res export.
- `src/editor/cropmath.js` holds the pure crop / rotation / output-size math. Crop is stored in source-image space, so it survives 90° rotation.
- Design rules live in `.agents/skills/nomi-design/SKILL.md` (dark, Claude Code look, no panels).
- Tests: `node tests/run.js`.
