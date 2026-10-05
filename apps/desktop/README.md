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

## Moved or disconnected media

Library checks source availability when a project opens, when returning to the
Library, after an import finishes, and after relinking. Check again refreshes it
on demand. Missing Media, Inaccessible Media, and Library offline describe current
source access; they never remove cached thumbnails or disable timeline editing.

Relink Media accepts a new folder or a single-file path. Native desktop buttons
open the scoped folder/file picker. Choose a library or selected asset to narrow
the search, review each candidate's matching evidence, and apply the chosen
sources. Only content-hash matches can be automatically selected. Relative path,
filename/size, and manual matches require an explicit choice and confirmation;
ambiguous matches require choosing a candidate. A known hash mismatch cannot be
confirmed through the interface. A failed application keeps its review visible so
the choices can be checked or a different location can be tried.

Relinking flushes pending timeline edits before planning or applying. After the
server commits a relink, the editor refreshes source references and rebuilds only
the selected source player. Asset identities, ratings, selections, locks, source
trims, and effects remain intact. Status checks use filesystem inspection through
the local service; they do not open a decoder for every media item.

## Camera formats and preview capabilities

The media inspector shows the detected device, codec, dimensions, frame rate,
color information, and available camera evidence without removing rating or
selection controls. Pixel identification uses the source adapter's recognition
result; uncertain sources retain their generic identity. Motion Photo detection
is marked Experimental and includes its evidence. Detection does not imply that
embedded motion has been extracted.

Insta360 exported flat media can preview normally. Raw 360 sources show
**360 source / Requires reframed export**, with instructions to create a flat
export in the source application. Original-source associations are shown with
their recorded evidence. A raw source or `openfilm.preview.supported: false`
never opens an original image/video decoder in the editor; an existing cached
thumbnail or placeholder remains visible, and metadata and editing controls stay
available. The same capability handles undecodable DNG files.

HDR, HEVC, and higher bit depth are visible with the preserved color metadata.
Preview warnings report the local media pipeline's actual capabilities, including
an SDR tone-mapped preview when supplied. The original source metadata remains
available for finishing; the UI does not claim native camera extraction,
stitching, reframing, or verified HDR display appearance.

## Proposal reference workflow and export reports

Follow the [generated proposal reference workflow](../../docs/reference-workflows/proposal-film.md)
for a complete CC0 exercise: camera metadata, preferences and required memories,
story beats, timeline editing, fit suggestions, preview, reopen, relink, and NLE
handoff. Selecting Proposal Film supplies 270/300-second defaults unless the user
has already edited the duration fields. Beat selections are explicitly described
as Must include; Library Always include and Timeline Lock clip have distinct
protection scopes described in the guide.

Exports retain a visible compatibility report beneath the saved path. OTIO warns
that a real Resolve import still needs manual verification; advanced edits kept
as OpenFilm metadata need recreation in Resolve. The warning list remains visible
after the transient success message is dismissed. Changing a cut marks a prior
export stale; changing projects or compositions clears the previous artifact's
report. See [NLE compatibility](../../docs/nle-compatibility.md) for the verification
boundary and manual finishing checks.
