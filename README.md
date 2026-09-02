# OnCue

A single-file Progressive Web App for a worship team's chord charts, built for live use on stage (primarily iPads).

## Architecture

- `index.html` — the entire app: HTML, CSS, and JS inline. No build step, no bundler, no framework.
- `sw.js` — service worker for offline support and cache-busting.
- `manifest.json` + `icons/` — PWA install metadata and icons.
- Firebase Realtime Database — live sync between devices (MD's "now playing" pushes to every connected Viewer).

Deployed via GitHub Pages from the `gh-pages` branch.

## Firebase setup (already done for this repo)

This app uses its **own, brand-new Firebase project** (`oncuev2`) — not the original OnCue's — so this rebuild can be developed and tested without any risk to another app's data.

- `FIREBASE_CONFIG` near the top of the `<script>` block in `index.html` is already filled in with the `oncuev2` project's real config.
- The Realtime Database's rules are set to open read/write:
  ```json
  {
    "rules": {
      ".read": true,
      ".write": true
    }
  }
  ```
  These rules are intentionally open — there's no per-user auth model here, just a soft passcode gate in the app UI (see below). Don't put this database somewhere you'd mind being publicly readable/writable.
- `MD_PASSCODE` (also near the top of the script) is currently `"lwc"` — change it if you like.

If `FIREBASE_CONFIG` ever gets reset to placeholder values (e.g. spinning up yet another project later), the app falls back to a **local-only mode** (data lives in that browser's `localStorage`, no cross-device sync) so the UI is still usable while re-configuring. A toast on load tells you when this fallback is active, and the sync-status dot in the header turns amber.

## Deploying to GitHub Pages

1. Push this repo to GitHub.
2. Settings → Pages → Deploy from a branch → `gh-pages` (or `main`, if you prefer serving directly from it) → `/ (root)`.
3. **Every time you deploy a change, bump `BUILD_ID` at the top of `sw.js`**, and `APP_VERSION` near the top of the `<script>` block in `index.html`, to the same value (e.g. the current timestamp). `BUILD_ID` is the entire cache-busting mechanism — a new value forces every connected device to drop its old cached copy and pull the fresh build instead of getting stuck on stale JS on stage. `APP_VERSION` just surfaces that same value as a small badge in the top-right corner of the landing screen, so you can glance at a device and confirm it picked up the latest push.

## Roles

- **MD (Musical Director)** — full edit access: manage the song library, build/edit setlists, and push the "now playing" song + chart version to every connected device.
- **Viewer** — read-only. Automatically follows the MD's live pushes.

The app opens on a **"Who are you today?"** landing screen where you pick MD or Viewer (and optionally jump straight into an existing setlist). Switching to MD is gated by `MD_PASSCODE` — currently `"lwc"`, change it near the top of the `<script>` block in `index.html`. This is a UI convenience, not real security — the database itself has open rules, matching the original app. Downgrading to Viewer needs no passcode. Tap the OnCue logo in the header any time to return to this screen and switch identity or load a different setlist.

## Chart data model

Deliberately simple, by design (see the project brief this was built from):

- A song has one or more **versions**, each just a label (`"D"`, `"Capo 3"`, `"Numbers"`, …) and a plain-text block, typed/pasted exactly as it should appear on stage.
- There is **no chord parsing, auto-transpose, or computed layout** of any kind. What's typed is what's shown, character for character.
- A version labeled `"Numbers"` (case-insensitive) is shown by default when present, since it lets anyone play regardless of key; otherwise the first version is shown.
- `[Section Header]` lines (e.g. `[Verse 1]`) split the chart into blocks for the two-column layout; everything else renders as-is.
- If a song is too long to fit one screen, it's split into multiple full-screen **pages** (each its own 1- or 2-column spread) rather than letting a single page scroll — swipe or use the arrows to move between pages, then automatically on to the next setlist song once you're past a song's last page. See "Rendering" below for how pages are computed.

### Whitespace integrity

Chart alignment is exact plain text — if the columns don't line up in the stored string, they won't line up on stage. To keep that robust:

- Every chart-entry textarea disables `autocorrect`, `autocapitalize`, `autocomplete`, and `spellcheck`, since iOS's autocorrect (particularly the double-space-inserts-a-period shortcut) can silently corrupt runs of spaces.
- On save, all whitespace-like characters except newlines (that includes non-breaking spaces picked up from pasted web/PDF content, and tabs) are normalized to a single plain ASCII space, so the stored text is portable and renders identically anywhere.

### Rendering

Chart text is rendered with a fixed character grid (`display:grid; grid-auto-flow:column; grid-auto-columns:1ch`, one `<span>` per character), not by trusting the font to be perfectly monospaced — this makes column position immune to font/kerning quirks. Whole lines are classified as chord lines or lyric lines and colored as a single unbroken text run (never per-token `<span>` coloring), which avoids the sub-pixel rounding drift that compounds when a line is split into multiple inline-colored fragments.

Chart light mode is a CSS class toggle scoped to the chart screen, with its own explicit color tokens — it never reads `prefers-color-scheme`, so it can't be silently overridden by the device's system theme.

### Pagination

A song's `[Section]` blocks are packed into full-screen pages: each block is measured (off-screen, at the real column width) and greedily placed into column 1 of a page, then column 2, then a new page — the same shape a CSS multi-column layout with a fixed height would produce, but computed in JS so it's capped at exactly 1 or 2 real columns instead of silently spilling into extra columns that would need horizontal scrolling. This recomputes on resize/rotation (debounced), clamping the current page into the new page count rather than resetting to page 1, so rotating an iPad mid-song doesn't lose your place.

`#app`'s height comes from `window.innerHeight` set via JS into a `--app-height` CSS variable, not from `100vh`/`100dvh` directly — iOS Safari's `100vh` famously includes the area behind its collapsible toolbar (taller than what's actually visible), and `100dvh` silently falls back to that same buggy `100vh` on any device whose Safari predates dvh support, which is common on older iPads that don't get OS updates. Either case feeds an inflated height into the pagination math above, which then packs way too much into column 1 alone (skipping column 2 entirely) while the real overflow sits below the visible fold, forcing a scroll — i.e., exactly "still one column and I have to scroll." `window.innerHeight` is the one height measurement iOS has always reported correctly.

Page position is **local, per-device, and never synced over Firebase** — different screens paginate the same song differently (an iPad in landscape fits far more per page than the same iPad in portrait, let alone a phone), so mirroring a page index across devices would be actively wrong. What *is* still synced is the song itself: swiping/tapping past a song's last page falls through to the existing setlist song-navigation (see below), which behaves exactly as before.

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
- [ ] MD push / Viewer read-only sync against the real `oncuev2` Firebase project, and swipe/arrow navigation not fighting with it — the sync *logic* was verified end-to-end (MD navigation updates the live pointer, a following Viewer updates automatically, a Viewer that navigates independently detaches without affecting the MD) with an automated test against the local-storage fallback store, since this sandbox's network policy blocks outbound calls to Firebase. Still needs a real check with two devices/tabs pointed at the live database.

The chart-light-mode and whitespace-normalization checks above were verified with a headless-browser smoke test; the on-device iPad check and the live-Firebase sync check still need a physical device / two real browser sessions.
