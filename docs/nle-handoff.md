# M7C — Reviewed NLE handoff v1

This is an additional OTIO exchange flow. Ordinary JSON/OTIO/FCPXML/EDL export
keeps its existing behavior. No project schema, TimelineEditor/history, locks,
source media, provider or remote service changes are introduced.

## Choices and evidence

`preserve-editability` is the default: native source trims, gaps and tracks remain
NLE objects; advanced recipes remain metadata. `preserve-visual-fidelity` explicitly
replaces the union of affected visual frame ranges with opaque H.264 precomps.
Native cuts outside those ranges survive with adjusted original source in/out.
The existing FFmpeg renderer renders the full saved context once; frame trims
avoid resetting GraphicScene animations, caption timing and transitions. The
reference MP4 is retained. Full-context rendering is intentionally slower than a
future context-aware range optimization. No second timeline/editor is created.

The version-1 `HandoffPlan` records owner IDs, exact half-open frame positions,
rational rate, native/metadata/baked/unsupported policy and reasons. Replaced cut
ranges are marked baked and source identity there becomes provenance metadata;
untouched ranges remain native. Fractional native positions remain fractional;
visual baking rejects boundaries crossing the output frame grid. Unsupported
fields, overlapping clips, alpha/stem requests and unsupported source formats
fail closed. Transparent overlays are disabled: no tested alpha profile is claimed.

Embedded source video audio is projected onto separate native Audio clips before
replacing any picture. Original audio source offsets/timing survive; authored
speed, gain and automation are still manual metadata unless **full mix** is chosen.
That explicit option replaces all audio with the same renderer's full mix, decoded
to PCM s24le WAV and verified at exactly the intended 48 kHz sample length. It
contains the renderer's existing AAC reference encoding; it is not advertised as
an uncompressed-original mastering pipeline. Individual stems await M7B #36.
Depth/parallax awaits M8A #35; unknown depth fields on this base are rejected.

Saved captions produce SRT and VTT. One selected language can be baked; other
languages remain metadata/sidecars. Styles are not claimed as native NLE caption
objects. Unsafe SRT text is rejected rather than rewritten. Segment timestamp
precision and stale-alignment warnings are retained, not upgraded to word timing.

## Exchange package

Desktop Export → NLE handoff → Review → Export produces `handoff.tar`. Unpack it
before opening `timeline.otio`. Files use application-generated ASCII relative
names, not original absolute paths. Sources are copied unchanged; hashes are
checked against catalog identities, after copy and again before publication.
Catalog FFprobe stream evidence must agree with a fresh stream inspection.
Missing identities require source refresh rather than silently rebinding.

The package contains native media copies, short precomps/full mix when requested,
`timeline.otio`, sidecars, `provenance.json`, `handoff.json`, actual reference MP4
and path-free render/mix evidence. Original Composition, recipes, source IDs,
hashes and exact original times stay in provenance and OTIO metadata. The TAR's
receipt inventories its contents; the private outer receipt additionally includes
the TAR hash (the archive cannot recursively hash itself). Consumers may discard
custom metadata; keep the original project and package for returning to OpenFilm.

Local staging/published artifacts remain in private per-project cache directories.
No shared cache or arbitrary output path is accepted. Staging is mode 0700,
files 0600; symlink parents, symlink/hardlinked downloads, traversal and foreign
project requests are rejected. v1 limits include 256 referenced assets, 1 GiB
source bytes, 2,000 clips / 5,000 cues / 128 tracks, 2 GiB archive payload and one hour of source timeline. Export fails
rather than publishing a partial package when a limit or codec cannot be met.

## Shared adapters

- `app.reviewHandoff(compositionId, options)` returns saved revision and plan.
- `app.exportHandoff({ projectId, compositionId, revision, ...options }, signal)`
  checks the saved/in-memory revision and source mappings, then atomically
  renames complete staging into the published private cache. Repeating an export
  creates a new receipt; untouched native OTIO/source bytes are reproducible.
- HTTP `POST /api/handoff/review`, `POST /api/handoff/export` share that service.
  HTTP disconnect aborts render/hash/archive work; shutdown waits for cleanup.
  File download uses project ID, publication UUID and inventory index, not paths.
- CLI `handoff review --project <p> --composition <id> [--mode preserve-visual-fidelity]
[--bake-audio] [--caption-track <id>]` prints review JSON. Save it locally and use
  `handoff export --project <p> --review <review.json>` to publish.

Any project save/relink/settings change that invalidates the snapshot prevents
publication. The final project-revision fence and rename are synchronous. Client
project/mode/language changes cancel work and discard obsolete replies. A completed
old package remains an immutable receipt; it is not silently relabeled current.

## Consumer gate

Official OpenTimelineIO 0.18.1 read/write/read is automated. Real Resolve,
Premiere and Final Cut import, playback, relinking, channel layout and color are
**not verified**. Use [the M7C workstation checklist](validation-nle-handoff.md).
No automatic native keyframe reconstruction is claimed.
