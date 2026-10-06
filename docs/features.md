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
3. Click a photo → **adjust** (11 Apple Photos-style sliders, double-click a slider to reset it) or **crop** (drag the box, the corners or the sides, Free/Original/Square/4:3/3:2/16:9, rotate 90°, straighten ±45°)
4. Done → `↓ album.zip` (full resolution, JPEG quality 1.0 or PNG, `name-edited.ext`, uncompressed STORE ZIP)

Motion is short and eased: views fade and rise, thumbnails fade in as they load, the editor photo and tab panels fade, toasts and the export menu rise in; all of it is off with reduced motion.

Cancel discards the edits made since the photo was opened. After Done or Cancel the album scrolls to that photo (centred if it was off-screen) and its card shows a 2px accent outline that fades after about a second (no fade with reduced motion).

- **Zoom to inspect (adjust / filters):** click the photo to zoom in 2× at that spot (click again for more, up to 8×), drag to move around, scroll to zoom back out. Zoom resets when you switch tabs or photos.
- **Compare with the original:** `◐ original` in the editor bar (or `\`) switches between the untouched photo and your edit. The framing (crop, rotation, straighten) stays the same, so a zoomed-in spot lines up exactly. Tones, filter and text are left out. Touching any control switches back to the edit.
- **Delete asks about the file:** deleting a photo (card ✕ or select mode) removes it from nomi with an undo toast. If it came from an opened folder, the toast says `removed … from the album · the file is still on disk` and offers `also delete file`. Click it to remove the file itself (Chrome/Edge will ask for write access once); ignore it and the file stays. Backups in `.nomi-originals` are never touched. Photos imported by drag/drop or the file picker have no file nomi can delete, so they only get the undo.
- **Photo to photo:** ← / → in the editor, the ‹ › arrows at the photo edges, or a filmstrip click. Switching keeps the current edits in nomi (like Done, nothing is written to disk until you save to folder), refreshes the thumbnail of the photo you leave, and starts a fresh undo history. Cancel only discards what changed since that photo was last opened. A slider you tabbed to with the keyboard keeps ←/→ for itself.
- **Undo / redo while editing:** `↶ ↷` in the editor bar, or ⌘Z / ⇧⌘Z. Each settled change is one step (a whole slider drag, a crop gesture, a filter pick). History is cleared on Done or Cancel.
- **Crop settles like iOS:** about a second after you release a crop handle, the view zooms and centers the crop so it fills the stage, and the cut area becomes solid. While dragging, the cut area is dimmed so you can pull the crop back out.

- **Gallery:** justified rows (like Google Photos). Every full row spans the width exactly and photos keep their ratio, with no stretching and no empty holes. It scrolls endlessly as the album grows.
- **Import:** there's no file limit. A spinner status and the album count update as each photo lands, and photos appear in the gallery as they load. Dropped folders are read recursively. Files the browser can't decode (e.g. HEIC in Chrome) are skipped and listed in the final summary instead of showing as broken tiles.
- **Filters:** the iOS Photos set (Vivid, Vivid Warm/Cool, Dramatic, Dramatic Warm/Cool, Mono, Silvertone, Noir) with live previews and an intensity slider. They're applied in the same shader at export.
- **Save back to your folder (Chrome / Edge):** use `open folder` on the albums page instead of Import. It creates an album that mirrors that folder, so the album has no Import button or drop area; manual albums keep them, then when you're done choose `↓ export` → **save to folder**.
  - What it writes: edited photos overwrite their files in the same format. JPEG is saved at quality 0.95, and its EXIF (camera, date, GPS) is copied across with orientation reset. The original's embedded preview thumbnail is dropped and the EXIF pixel size is updated, so Finder, Quick Look and Photos show the edited picture instead of the old one. PNG/WebP metadata isn't kept.
  - Backups: before the first overwrite, the untouched original is copied to `.nomi-originals/`, and later saves never replace that backup.
  - Copies: duplicates are written as new files (`name copy.jpg`).
  - Skipped: unedited photos aren't rewritten. HEIC/GIF/TIFF can't be written back, so they're skipped.
  - Afterwards: nothing is baked in. nomi keeps the original bytes, the original size and all your settings in memory, so the photo reopens with every slider, filter, crop, rotation and text exactly as you left it, and you can keep tweaking. Saving again renders from the original (never from the file already written, so nothing is applied twice) over the same file; the backup in `.nomi-originals/` is never touched. nomi remembers the settings of the last save, so the export menu only offers files that differ from disk (`nothing changed since last save` otherwise), and saved photos keep their edited dot. Reload and reopen the folder and the files on disk are the new starting point.
  - Confirmation: saving asks once, inline. You pick the folder again each session; nothing is remembered.
- **Export menu:** `↓ export` (album) and `export N` (selection) both offer **save to folder** or **download zip**.
- **Select / delete:** `select` mode lets you export just the chosen photos (`Album (3 of 14).zip`) or delete them. Deleting (per photo `✕` or in bulk) shows an undo. `↓ album.zip` exports everything and shows a spinner with a count while it works.
- **Duplicate:** hover a photo and click `⧉ duplicate`, or press `Duplicate` in the editor. The copy keeps the edits, gets a `name copy.ext` name, and appears right after the original. ZIP names never collide.

## Tech

- Plain HTML + ES modules, zero npm deps. WebGL2 single-pass shader for preview (2048px cap) and full-res export.
- `src/editor/cropmath.js` holds the pure crop / rotation / output-size math. Crop is stored in source-image space, so it survives 90° rotation.
- Design rules live in `.agents/skills/nomi-design/SKILL.md` (dark, Claude Code look, no panels).
- Tests: `node tests/run.js`.
