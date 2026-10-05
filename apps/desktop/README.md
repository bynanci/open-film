# OpenFilm desktop

The Vue workspace uses the local application service at `127.0.0.1:4310`.
No remote fonts, media, models, or upload services are requested. Timeline strips use cached thumbnails of imported local media; only the
selected clip opens its original source for inspection. No clip strip creates
individual video decoders.

From the repository root, `pnpm dev` starts the API and Vite on ports 4310 and 1420. `pnpm --filter @openfilm/desktop build` builds the frontend. The browser
workflow supports all project, library, story, preview, and export operations;
folder paths can be entered directly. A Tauri window adds the native folder
picker through the narrowly scoped `pick_folder` command.

## Native shell

With the platform's Tauri prerequisites installed, run
`pnpm --filter @openfilm/desktop tauri dev`. Tauri's development hook runs the
repository's combined development command. Stop an existing `pnpm dev` before
starting this hook to avoid duplicate servers. Linux requires Rust, a C/C++
toolchain, GTK 3, WebKitGTK 4.1, and related Tauri system libraries. Consult
[Tauri's platform prerequisites](https://v2.tauri.app/start/prerequisites/).

For a compiled shell, start the bundled Node application service separately, or
set `OPENFILM_NODE_PATH` to an absolute Node 24.14+ executable and
`OPENFILM_SERVER_PATH` to the absolute `dist/server/index.mjs` path before
launching. The shell starts that executable with the server path as a separate
argument and stops only its own child on exit. It never executes a shell string.
These variables are local executable configuration, not project or user input.
The API accepts the Tauri application origin and restricts external requests.

Installer bundling is intentionally disabled for this milestone: a redistributable
package still needs a verified platform-specific Node runtime, FFmpeg/FFprobe,
and optional ExifTool resources. A frontend build alone does not validate the
native shell or produce a standalone desktop installer.

The API-backed browser E2E test creates real temporary media with FFmpeg, imports
it, edits selections and a story beat, composes, renders an MP4, exports, and
reopens the project. It does not substitute fixture screens or mock requests.

## Graphical editing

The Timeline workspace groups clips by story beat. Select a clip for source
in/out, still duration, speed, volume/mute, Cut/Crossfade, and transform controls.
Drag a clip inside its beat to reorder it, or use Earlier/Later in the inspector.
Lock protects a clip from changes; unlock it before replacing or deleting it.
Select a beat header to rename it, edit its intent and timing, or regenerate only
that beat. Fit to target explains shortening suggestions and lets you apply each
one or the complete plan. Over-limit cuts can be saved, but must be shortened
before rendering.

Edits appear immediately and save after a 400ms pause. The Saved/Saving/Save
failed indicator reports persistence; Retry save retains and resends the same
batch safely. Unsaved drafts are also retained in browser storage for recovery.
If another window changes the saved cut, the conflict keeps the local draft;
Apply draft to latest explicitly replays its edits over the latest saved cut.
Download unsaved draft keeps a JSON backup; Discard draft and load latest is an
explicit recovery action when changes can no longer be replayed.
Navigation, cut/project switches, undo/redo, render, and export flush pending
commands first. A stale rendered preview is labelled until it is rendered again.

Space plays the selected source (or available film preview for a still), arrow
keys select adjacent clips, Delete removes an unlocked clip, and Cmd/Ctrl Z and
Cmd/Ctrl Shift Z undo and redo. These shortcuts leave text and number fields to
normal typing. Originals are never modified.
