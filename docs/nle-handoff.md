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
only the boundaries used for visual baking must lie on the output frame grid.
Untouched native picture/audio edges retain fractional timing. A full mix still
requires a frame-aligned Composition end because the existing renderer ends at
the last complete frame. Unsupported
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
Selected baked cues use the renderer's next-frame conversion for millisecond
boundaries, clipped to the last complete reference frame. Cues with no visible
reference frame remain metadata/sidecars. Native cue times and SRT/VTT milliseconds
remain unchanged. Reference rendering retains its 64-selected-cue limit; choose
no caption language or preserve editability without full mix for larger sidecars.

Render-required title/caption review applies the same 33,177,600-pixel (8K)
raster limit as publication. Native metadata exchange remains available without
rendering; unselected or zero-frame captions do not add a text-raster requirement.

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
No shared cache or arbitrary output path is accepted. Source transport is an
exclusive abortable stream; imported portable references are rewritten to contain
only relative package names and source hashes. Staging is mode 0700,
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

Both CLI commands use passive export opening, preserving saved project/catalog
state without workspace media-reference repair, interrupted-job recovery or a
save on close. Publication still writes its owned private cache artifacts.

Any project save/relink/settings change that invalidates the snapshot prevents
publication. The final project-revision fence and rename are synchronous. Client
project/mode/language changes cancel work and discard obsolete replies. A completed
old package remains an immutable receipt; it is not silently relabeled current.

## Consumer gate

Official OpenTimelineIO 0.18.1 read/write/read is automated. Real Resolve,
Premiere and Final Cut import, playback, relinking, channel layout and color are
**not verified**. Use [the M7C workstation checklist](validation-nle-handoff.md).
No automatic native keyframe reconstruction is claimed.

Handoff timing preserves the configured frame-rate value: decimal 29.97 is
2997/100, distinct from 30000/1001. Native fractional cut positions are retained;
only actual bake boundaries require frame alignment. Plans allow at most 128
disjoint visual precomps. Extraction seeks near each interval before exact
source-PTS trimming, and rendered clips disable inherited color looks because
the reference already contains them. Original recipes remain in provenance.

CLI review supports `--caption-track <id>` or `--no-captions` (mutually exclusive).
The default selects the first caption track; no-caption selection still retains
sidecar captions. Review JSON is bounded to 16 MiB, including the supported
5,000-cue plan. Visible titles on audio/music clips are explicitly unsupported:
move them to a visual track before handoff, rather than losing them during mix.

Review rejects timelines exceeding one hour or 256 distinct source assets.
Title-track clips must bind an existing catalog source: unresolved synthetic
placeholder IDs are explicitly unsupported in this handoff slice, even when
standalone title rendering could otherwise ignore their source ID.

Approval identity includes referenced catalog records as well as saved project
settings/timelines: refreshing/reimporting a same-ID source requires a new review.
Short transitions bake only their actual duration; the native remainder does not
reapply the transition. Full-frame verification and derivative FFmpeg jobs have a
30-minute upper deadline and retain cancellation support.

The opaque review token binds the complete normalized plan as well as project
and source revisions. Changing mode, mix or caption selection requires reviewing
again. Audio-only assets on video/overlay tracks are explicitly unsupported in
this slice: move them to Audio before handoff. Review JSON is limited to 2 MiB
after range expansion and caption tracks to 128, leaving bounded inventory space
within the 4 MiB downloadable receipt cap. The 5,000-cue CLI regression remains
supported; large bake expansion must be reduced or use preserve-editability.

Sidecars sort a copy of saved caption cues chronologically; original cue storage
order is retained. A disconnected queued request cannot publish after cancellation:
HTTP body reading happens after the mutation queue and rejects destroyed requests,
covered for both chunked and Content-Length transport.
