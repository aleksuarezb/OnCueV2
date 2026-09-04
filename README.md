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
- A version labeled `"Numbers"` (case-insensitive) is shown by default when present, since it lets anyone play regardless of key; otherwise the first version is shown. This is always true for a song opened standalone from the Library — see "Per-setlist key" below for the one place that default can be overridden.
- `[Section Header]` lines (e.g. `[Verse 1]`) and common bare headers written without brackets (`INTRO`, `VERSE 1`, `PRE-CHORUS`, etc.) render bold; everything else renders as-is.
- If a song is too long to fit one screen, it's split into multiple full-screen **pages** rather than letting a single page scroll — swipe or use the arrows to move between pages, then automatically on to the next setlist song once you're past a song's last page. See "Rendering" below for how pages are computed.
- A song's **title, artist, tags**, and an optional freeform **info line** (e.g. `Key - C | Tempo - 64 | Time - 4/4`) are separate metadata fields, entered in the editor alongside the title/artist — not typed into the chart text. The info line shows next to the song title in the chart screen's top bar instead of taking up a line inside the paginated chord content.

### Current Key vs. Chart Key (setlist mode)

There are two separate, deliberately decoupled ideas here, both living beside the song title in the chart screen's top bar:

- **Current Key** — the key the *band* is playing this song in for this setlist, e.g. `Current Key: D`. Only the MD can change it (a small pill-select next to the title when there's more than one version); Viewers see it as read-only text. This is shared, synced data — it lives on the setlist entry itself (`items[].versionId`, same field as before) and updates for everyone the instant the MD changes it, independent of Firebase's `/live` pointer.
- **Chart Key** — the top-right version-select dropdown, unchanged in position, but a purely personal, per-device choice, changeable by MD and Viewer alike: pick a different chart version for yourself (e.g. a capo chart) without changing what anyone else sees. It never writes to Firebase and never affects song-navigation "following." Changing it remembers the chosen version's *label* (not its id) as this device's standing preference, in `localStorage`, so a guitarist who picks "Capo 3" once gets it automatically on every later song — in this setlist or any other — that happens to have a matching-labeled version. Outside setlist mode (opening a song standalone from the Library) none of this applies; it's always Numbers/first version as before.

Resolution order for what a given device actually renders, whenever it's viewing a song within a setlist: **this device's preferred Chart Key label** (if the current song has a matching version) → **the Current Key** for that setlist entry → **the song's own default** (Numbers/first). A device with no preference set simply follows the Current Key automatically, including live updates when the MD changes it later. If a Current Key's version is later deleted from the song, it silently falls back to the song's normal default rather than showing a blank chart.

Setlists store the Current Key as `items: [{songId, versionId}]` (`versionId: null` = no override, same shape as before this feature — only how it's *used* changed, not the data). Older setlists saved before per-setlist keys existed only have a flat `songIds: [id, ...]` array; that's still read correctly (each entry treated as `{songId: id, versionId: null}`) and gets upgraded to `items` automatically the next time that setlist is edited — no manual migration needed.

### Whitespace integrity

Chart alignment is exact plain text — if the columns don't line up in the stored string, they won't line up on stage. To keep that robust:

- Every chart-entry textarea disables `autocorrect`, `autocapitalize`, `autocomplete`, and `spellcheck`, since iOS's autocorrect (particularly the double-space-inserts-a-period shortcut) can silently corrupt runs of spaces.
- On save, all whitespace-like characters except newlines (that includes non-breaking spaces picked up from pasted web/PDF content, and tabs) are normalized to a single plain ASCII space, so the stored text is portable and renders identically anywhere.

### Rendering

Chart text is rendered with a fixed character grid (`display:grid; grid-auto-flow:column; grid-auto-columns:1ch`, one `<span>` per character), not by trusting the font to be perfectly monospaced — this makes column position immune to font/kerning quirks. Whole lines are classified as chord lines or lyric lines and colored as a single unbroken text run (never per-token `<span>` coloring), which avoids the sub-pixel rounding drift that compounds when a line is split into multiple inline-colored fragments.

Chart light mode is a CSS class toggle scoped to the chart screen, with its own explicit color tokens — it never reads `prefers-color-scheme`, so it can't be silently overridden by the device's system theme.

### Pagination

Every individual line of the chart — not whole `[Section]` blocks — is the atomic unit pagination packs into columns/pages: each line is measured (off-screen, at the real column width) and greedily placed into column 1 of a page, then column 2, then a new page — the same shape a CSS multi-column layout with a fixed height would produce, but computed in JS so it's capped at exactly 1 or 2 real columns instead of silently spilling into extra columns that would need horizontal scrolling. This recomputes on resize/rotation (debounced), clamping the current page into the new page count rather than resetting to page 1, so rotating an iPad mid-song doesn't lose your place.

Packing by whole section (keeping a verse together, never split across a column) sounds nicer, but was the actual root cause the first time this broke: real charts don't reliably mark section boundaries the way the packer expected (no `[brackets]`, no blank lines between verses), so an entire song with no detected section boundary became one indivisible block far taller than a page — everything crammed into column 1, column 2 stayed empty, and the real content past the visible fold needed a scroll to reach. Packing line-by-line instead guarantees a page always fills and always stays inside the visible screen, regardless of how a chart happens to be formatted. `[Verse 1]`-style bracketed headers and common bare headers written without brackets (`INTRO`, `VERSE 1`, `PRE-CHORUS`, etc.) both still render bold — that recognition only affects styling now, not pagination.

Since packing is automatic and line-by-line, a verse can occasionally land split across a column anyway — the tradeoff for guaranteeing a page never overflows. For the rare case that's worth fixing by hand, a line containing exactly `---` is a manual break marker: it never renders, but forces whatever comes after it to start at the top of the next column (or the next page, if it's already the last column of a page). Put one right before a section you want kept together. A `---` at the very top of a column is a no-op rather than leaving a blank leading column.

`#app`'s height comes from `window.innerHeight` set via JS into a `--app-height` CSS variable, not from `100vh`/`100dvh` directly — iOS Safari's `100vh` includes the area behind its collapsible toolbar (taller than what's actually visible), and `100dvh` silently falls back to that same buggy `100vh` on any device whose Safari predates dvh support. This turned out not to be the cause of the column bug above (that was the section-packing issue), but it's a real, separate iOS quirk worth guarding against regardless.

Add `?debug=1` to the URL to show a small on-screen readout (window size, `--app-height`, `#chart-render`'s measured rect, and the pagination math's inputs/outputs) — useful for diagnosing a layout issue on a device this project can't directly test against.

Page position is **local, per-device, and never synced over Firebase** — different screens paginate the same song differently (an iPad in landscape fits far more per page than the same iPad in portrait, let alone a phone), so mirroring a page index across devices would be actively wrong. What *is* still synced is the song itself: swiping/tapping past a song's last page falls through to the existing setlist song-navigation (see below), which behaves exactly as before.

## Setlist navigation — design decision

**All browsing is local and silent; only an explicit "Push to Everyone" tap, confirmed first, ever reaches a Viewer.** This app went through two different designs here before landing on this one — worth explaining both the current behavior and why it changed:

- Swiping or tapping the arrows — through a setlist's songs, through a long song's own pages, or opening a standalone song from the Library — **never by itself sends anything to anyone**. It only moves the screen of the device doing it. An MD can flip through the entire setlist, jump to the Library and back, or preview any song, with zero effect on what Viewers see.
- The **only** way a song reaches Viewers is the "🔴 Push to Everyone" button on the chart screen (MD only), which is available for whatever song is currently on screen — a setlist song or a standalone Library pick, treated identically. Tapping it asks "Push '*Song*' to everyone now?" before anything changes, unless the MD has turned that off (see Settings below). The button reads "⏹ Stop Live" instead when the song on screen is already the one pushed, and stopping needs no confirmation.
- Once pushed, a following Viewer's screen updates immediately — same as before. A Viewer who swipes/taps detaches from "following" and browses independently, with a "● Live: *Song* — tap to follow" pill to jump back at any time, and is never yanked away mid-read by anything the MD does elsewhere. Tapping the live banner (Library screen, or a fresh Viewer session) starts in "following" mode.
- **Settings (⚙, MD only, in the header):** "Ask before pushing a song to everyone" — on by default. Turn it off to make the push button fire instantly with no confirmation, for an MD who'd rather move fast than double-check every time. This is a per-device preference (`localStorage`), not a shared one — each MD's device remembers its own choice.

Earlier this same button auto-pushed on every swipe while "driving live," which meant just glancing ahead at the next song's chart moved everyone else's screen too. That's the opposite of what's wanted in practice — an MD often wants to preview or skip around without disturbing the band — hence the explicit-push-only redesign above.

Navigation arrows are hidden entirely for a chart with no pages left to move through and no setlist context (a standalone song with only one page). They hide/disable at the first/last song in a setlist rather than wrapping around.

## What was deliberately not built

Per the project brief, to avoid re-introducing the old app's alignment bugs and complexity:

- No chord-to-number or number-to-chord auto-conversion/transposition.
- No computed chord/lyric row reconstruction or per-chord position editor.
- No colored Nashville-number summary grid.
- No show/hide-verses setting.
- No secondary/developer-mode chart editor — one textarea per version is the only way to enter chart text.
- No separate lyrics-only view — the chart *is* the display.

## Voice search

Tap 🎤 (Library toolbar, or the chart screen's top bar) and say a song title or a line of its lyrics — it opens that song, exactly as if you'd tapped its card in the Library. It's local navigation like any other browsing here: it never pushes to anyone, and works the same for MD and Viewer.

Matching (`findSongByVoice`) scores every song by title (exact match, then substring either direction, then word-overlap) and by lyric content (the spoken phrase found verbatim in a non-chord, non-header line of any version, requiring at least 4 characters spoken to avoid noise), and opens whichever song scores highest above a confidence floor — or tells you it found no match rather than guessing wrong.

This uses the browser's built-in Web Speech API (`SpeechRecognition`/`webkitSpeechRecognition`), not a bundled speech model — there's nothing to ship or configure, but it also means: it needs an internet connection (dictation is server-side, at least on Safari/iOS), it asks for microphone permission the first time, and it's unsupported (button just explains this) on a browser that doesn't implement the API at all. This project's sandbox has no microphone or real speech backend to test against, so the matching logic was verified directly (mocked transcripts through the real button-click flow) rather than with actual voice input — worth a real on-device check.

## Acceptance checks

- [x] Paste from a real SongSelect PDF / webpage, save, and copy the text back out — spacing should be pixel/character-identical (verified programmatically: NBSP and tab characters are normalized to plain spaces on save without altering column position).
- [ ] View on an actual iPad, portrait and landscape — confirm two-column layout and no horizontal scroll for normal-length lines (columns collapse to one below ~600px width; verify visually on-device).
- [x] Toggle chart light mode with the OS in dark mode — verified the toggle is driven purely by an in-app CSS class, independent of `prefers-color-scheme`, and text stays legible in both directions.
- [ ] MD push / Viewer read-only sync against the real `oncuev2` Firebase project, and swipe/arrow navigation not fighting with it — the sync *logic* was verified end-to-end (MD navigation updates the live pointer, a following Viewer updates automatically, a Viewer that navigates independently detaches without affecting the MD) with an automated test against the local-storage fallback store, since this sandbox's network policy blocks outbound calls to Firebase. Still needs a real check with two devices/tabs pointed at the live database.

The chart-light-mode and whitespace-normalization checks above were verified with a headless-browser smoke test; the on-device iPad check and the live-Firebase sync check still need a physical device / two real browser sessions.
