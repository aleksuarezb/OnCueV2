# OnCue

A single-file Progressive Web App for a worship team's chord charts, built for live use on stage (primarily iPads).

## Architecture

- `index.html` — the entire app: HTML, CSS, and JS inline. No build step, no bundler, no framework.
- `sw.js` — service worker for offline support and cache-busting.
- `manifest.json` + `icons/` — PWA install metadata and icons.
- Firebase Realtime Database — live sync between devices (MD's "now playing" pushes to every connected Viewer).

Deployed via GitHub Pages from the `gh-pages` branch.

## One-time setup: Firebase

This app needs its **own, brand-new Firebase project** — do not reuse an existing OnCue project, so this rebuild can be developed and tested without any risk to another app's data.

1. Go to the [Firebase console](https://console.firebase.google.com/) and create a new project.
2. In the project, add a **Web app** (the `</>` icon) to get a config object.
3. Enable **Realtime Database** (Build → Realtime Database → Create Database). Start in test mode, or set the rules explicitly to open read/write (matching the original app):
   ```json
   {
     "rules": {
       ".read": true,
       ".write": true
     }
   }
   ```
   These rules are intentionally open — there's no per-user auth model here, just a soft passcode gate in the app UI (see below). Don't put this database somewhere you'd mind being publicly readable/writable.
4. Copy the six config values (`apiKey`, `authDomain`, `databaseURL`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`) into the `FIREBASE_CONFIG` object near the top of the `<script>` block in `index.html`.
5. Optionally change `MD_PASSCODE` (also near the top of the script) from the default `"oncue"`.

Until `FIREBASE_CONFIG` is filled in, the app runs in a **local-only fallback mode** (data lives in that browser's `localStorage`, no cross-device sync) so you can build/demo the UI immediately. A toast on load tells you when this fallback is active, and the sync-status dot in the header turns amber.

## Deploying to GitHub Pages

1. Push this repo to GitHub.
2. Settings → Pages → Deploy from a branch → `gh-pages` (or `main`, if you prefer serving directly from it) → `/ (root)`.
3. **Every time you deploy a change, bump `BUILD_ID` at the top of `sw.js`** (e.g. to the current timestamp). This is the entire cache-busting mechanism — a new value forces every connected device to drop its old cached copy and pull the fresh build instead of getting stuck on stale JS on stage.

## Roles

- **MD (Musical Director)** — full edit access: manage the song library, build/edit setlists, and push the "now playing" song + chart version to every connected device.
- **Viewer** — read-only. Automatically follows the MD's live pushes.

Switching a device to MD mode is gated by `MD_PASSCODE` (a UI convenience, not real security — the database itself has open rules). Tap the role pill in the header to switch; downgrading to Viewer needs no passcode.

## Chart data model

Deliberately simple, by design (see the project brief this was built from):

- A song has one or more **versions**, each just a label (`"D"`, `"Capo 3"`, `"Numbers"`, …) and a plain-text block, typed/pasted exactly as it should appear on stage.
- There is **no chord parsing, auto-transpose, or computed layout** of any kind. What's typed is what's shown, character for character.
- A version labeled `"Numbers"` (case-insensitive) is shown by default when present, since it lets anyone play regardless of key; otherwise the first version is shown.
- `[Section Header]` lines (e.g. `[Verse 1]`) split the chart into blocks for the two-column layout; everything else renders as-is.

### Whitespace integrity

Chart alignment is exact plain text — if the columns don't line up in the stored string, they won't line up on stage. To keep that robust:

- Every chart-entry textarea disables `autocorrect`, `autocapitalize`, `autocomplete`, and `spellcheck`, since iOS's autocorrect (particularly the double-space-inserts-a-period shortcut) can silently corrupt runs of spaces.
- On save, all whitespace-like characters except newlines (that includes non-breaking spaces picked up from pasted web/PDF content, and tabs) are normalized to a single plain ASCII space, so the stored text is portable and renders identically anywhere.

### Rendering

Chart text is rendered with a fixed character grid (`display:grid; grid-auto-flow:column; grid-auto-columns:1ch`, one `<span>` per character), not by trusting the font to be perfectly monospaced — this makes column position immune to font/kerning quirks. Whole lines are classified as chord lines or lyric lines and colored as a single unbroken text run (never per-token `<span>` coloring), which avoids the sub-pixel rounding drift that compounds when a line is split into multiple inline-colored fragments.

Chart light mode is a CSS class toggle scoped to the chart screen, with its own explicit color tokens — it never reads `prefers-color-scheme`, so it can't be silently overridden by the device's system theme.

## Setlist navigation — design decision

**MD's navigation pushes to everyone; a Viewer's swipe/tap only browses locally without disrupting the MD's live position.** Concretely:

- While the MD is driving a setlist live, every swipe/arrow-tap (and version switch) updates Firebase's `/live` pointer, and every following Viewer's screen updates immediately.
- If a Viewer swipes or taps an arrow, that device detaches from "following" and browses the setlist on its own — it does **not** affect the MD or other viewers. A small "● Live: *Song* — tap to follow" pill appears so they can jump back to the MD's current song at any time.
- If the MD moves to a different song while a Viewer is detached, the Viewer is **not** yanked away mid-read; the pill's label just updates to point at wherever the MD currently is.
- Tapping the live banner on the Library screen (or a fresh Viewer session) starts in "following" mode, matching "Viewer receives MD's pushes automatically."
- An MD can also open a song from a setlist without pressing **Go Live** — that's just a local preview and does not push to anyone until the MD explicitly presses **Go Live** (or turns it off with **Stop Live**).
- Navigation arrows are hidden entirely for a chart opened outside of any setlist (a standalone song from the library), since there's nothing to navigate between. They also hide/disable at the first/last song in a setlist rather than wrapping around.

This was a judgment call favoring "don't disrupt someone mid-read" over strict lockstep; flagging it here per the project brief in case the actual preference differs.

## What was deliberately not built

Per the project brief, to avoid re-introducing the old app's alignment bugs and complexity:

- No chord-to-number or number-to-chord auto-conversion/transposition.
- No computed chord/lyric row reconstruction or per-chord position editor.
- No colored Nashville-number summary grid.
- No show/hide-verses setting.
- No secondary/developer-mode chart editor — one textarea per version is the only way to enter chart text.
- No separate lyrics-only view — the chart *is* the display.

## Acceptance checks

- [x] Paste from a real SongSelect PDF / webpage, save, and copy the text back out — spacing should be pixel/character-identical (verified programmatically: NBSP and tab characters are normalized to plain spaces on save without altering column position).
- [ ] View on an actual iPad, portrait and landscape — confirm two-column layout and no horizontal scroll for normal-length lines (columns collapse to one below ~600px width; verify visually on-device).
- [x] Toggle chart light mode with the OS in dark mode — verified the toggle is driven purely by an in-app CSS class, independent of `prefers-color-scheme`, and text stays legible in both directions.
- [x] MD push / Viewer read-only sync, and swipe/arrow navigation not fighting with it — verified end-to-end with an automated Firebase-fallback-store test: MD navigation updates the live pointer, a following Viewer updates automatically, and a Viewer that navigates independently detaches without affecting the MD.

The two `[x]` items above were verified with a headless-browser smoke test against the local-storage fallback store (this sandbox has no live Firebase project); the on-device iPad check still needs a physical device.
