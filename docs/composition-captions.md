# Composition-aware subtitle export

## Scope and acceptance

A corrected transcript is useful knowledge, but the current cut needs its own
subtitle clock. This slice lets a person choose one dialogue/narration track in
Export, inspect mapped cues and warnings, and download SRT or WebVTT with a source
receipt. It reuses existing transcript revisions and application operations;
original audio, transcript evidence, Story, timeline history and autosave remain
unchanged. No transcription, remote provider, caption track or schema migration
is required. Burn-in, styling, karaoke and guessed word alignment are excluded.

[The pinned OpenCut comparison and gap matrix](opencut-reference.md) explains why
this workflow precedes broader variants, recipes, plugins, MCP or compositors.
OpenFilm already has headless CLI operations; this adds one shared use case.

## Contract selected before implementation

- Pure Core mapping uses one explicitly selected video/audio/music track. Each
  clip instance contributes separately. Intersect source ranges before mapping
  `timelineStart + (sourceTime - sourceIn) / speed`; accept only valid positive
  constant speeds and consistent durations. Gaps retain their timeline offsets.
  When source-out is omitted, the range stops at the known source duration, as
  in the renderer; any padded silent tail contributes no captions. Explicit
  out-of-range trims remain an error.
- Use whole segments fully within a retained source range. Omit a boundary-cut
  segment with a specific warning instead of guessing retained words or including
  cut-out speech. Corrected text keeps segment timing and its stale-word warning.
  Estimated boundaries remain disclosed. Overlaps remain present and are reported.
- Round starts upward and ends downward to milliseconds so output never extends
  into removed audio. Warn/omit cues that round to zero duration. Crossfades use
  existing renderer semantics; frozen visual tails add no speech or cue offset.
- Application export uses the project's frame rate and the same complete-frame
  output duration helper as the renderer. A sentence cut by that final frame
  boundary is omitted with a warning, just like a sentence cut by a source trim.
  The pure mapper's optional `frameRate` can be omitted by consumers explicitly
  working in nominal composition time; Desktop, HTTP and CLI always provide it.
- Application snapshots bind project, composition/editor revision, selected track,
  clip/source ranges, transcript revisions/source hashes and format options.
  Bounded preview pages include cue provenance and structured warnings. Changed
  composition/transcript/source makes the snapshot stale; regenerate before export.
  Source bindings include the mapper's metadata inputs (name, media type,
  duration, preview eligibility and audio presence), so catalog-only changes also
  invalidate the snapshot. Frame-rate changes are checked in memory and on disk.
- Unique project-owned export directories publish subtitle and manifest together
  through staging then rename. Cancellation/failure cleans staging; no arbitrary
  output path can replace media. Existing immutable outputs retain their original
  receipt and are never silently relabeled as the newest cut.
- Desktop, HTTP and CLI call the same application service. Desktop responses and
  downloads are project-bound, with disposed/delayed requests ignored. The UI
  presents text/time preview, not a burn-in or final-player claim. Cue and warning
  timestamps use `HH:MM:SS.mmm`, including hour-long films. Download links remain
  available during unchanged pagination/status refreshes; a new selection,
  preparation or stale revision clears them to avoid presenting an old export
  as the current cut.

## Required verification

Domain cases cover trim, split, speed, gaps, duplicate asset instances, overlaps,
alignment, missing sources/transcripts, rounding and Unicode. Application checks
cover revision changes, cancellation, safe publication, reopen and isolation.
Browser checks open a real project, inspect warnings, download real files, verify
project switching and localized layouts. Independent FFmpeg SRT and Chromium
WebVTT parsers validate output; neither proves NLE playback or ASR quality.

Validation results will be recorded after implementation against the candidate
commit. Real Resolve, model/GPU, camera/HDR/4K and installer checks remain the
separate [workstation gates](workstation-qa.md), tracked in issue #7.

## Use the flow

1. Open a saved project and use **Edit → Transcript** to finish any corrections.
   Save the current cut, then open **Export → Subtitles**.
2. Choose one video/dialogue, audio/narration or music source track explicitly.
   Other tracks are not mixed into this subtitle file. Muted clips and video
   sources without a renderer-audible audio stream contribute no cues.
3. Generate a preview. Read the cue text, film time, original asset name and
   transcript revision. Review missing speech, boundary omissions, estimated or
   edited alignment, and overlaps. Preview lists are paged (100 cues / 20 issues
   initially, at most 200 per request); this is not a burn-in player.
4. Export **SRT** or **WebVTT**, then download the file and its source record.
   The publication is an immutable copy. A deleted or unreadable subtitle is
   reported as unavailable with guidance to export a new copy. If the film, source or transcript has
   changed, regenerate the preview; an old snapshot cannot publish as current.
5. Keep the adjacent `manifest.json` with the subtitle. It records the project,
   composition revision, clip timing/speed/ranges, transcript revisions and
   provider provenance, frame rate and actual output duration, warnings, and
   output SHA-256.

Published manifest version 2 also carries a SHA-256 digest over its complete
payload. Readers verify it before returning publication metadata, a source record
or subtitles; changed text, bindings, provenance or output hashes are rejected.
Verification does not depend on the preview cache, so an intact export remains
readable after cache cleanup. Older unchecked manifests require a new export.
This detects altered contents; it is not a signature against a writer who can
replace both payload and digest.

No cloud provider is contacted. Both formats keep overlaps rather than silently
moving or dropping dialogue; a player's display of overlaps is its own behavior.
SRT has no universally shared literal-markup escaping. Ordinary ampersands remain
literal. Text containing angle/ASS control syntax or timestamp-like lines is
refused for SRT with a specific **use WebVTT** message. WebVTT escapes literal
markup. Empty lines use a nonbreaking-space payload to keep a cue intact;
unsupported controls and invalid Unicode produce errors instead of corrupted
text. Starts round up and ends down, allowing only a tiny floating-point tolerance
at exact millisecond boundaries; no positive minimum duration is invented.

## Headless and HTTP

```sh
pnpm cli captions prepare --project /path/film.openfilm --composition <id> --track <id>
pnpm cli captions get <snapshot-id> --project /path/film.openfilm --offset 0 --limit 100
pnpm cli captions get <snapshot-id> --project /path/film.openfilm --issue-offset 200 --issue-limit 100
pnpm cli captions get <snapshot-id> --project /path/film.openfilm --source-offset 200 --source-limit 100 --clip-offset 200 --clip-limit 100
pnpm cli captions export <snapshot-id> --project /path/film.openfilm --format srt
pnpm cli captions export <snapshot-id> --project /path/film.openfilm --format vtt
```

Commands return JSON; publication `relativePath` is under the chosen project.
Cue, warning, source and clip-binding pagination are independent. Use
`--issue-offset` / `--issue-limit`, `--source-offset` / `--source-limit` and
`--clip-offset` / `--clip-limit` to inspect later pages. Every collection has its
own total count and bounded page; page sizes are capped at 200 by the shared
application contract. Full source provenance and clip timing remain retrievable
even when an error prevents export. Raw `360-video` sources remain unsupported,
matching the renderer's requirement for a reframed flat export, even when a
stored transcript and audio stream are present. A playable flat export is a
normal video source.
Each export creates its own `exports/captions-<id>/` directory containing the
subtitle and `manifest.json`. Re-running never replaces an existing output.
Snapshots remain in `cache/captions/` and can be read after reopening. Cancellation
or a failed staged write publishes neither file; a successful output whose HTTP
acknowledgement was lost is still a complete immutable publication, not a partial
file. A retry creates another copy. No timeline Undo step is added.

The CLI uses `OpenFilmApplication.openForExport`: no automatic job recovery,
persisted media-reference rewrite or project save on close. Managed uploads are
resolved against the current project location in memory, so a moved project can
prepare captions directly through the CLI. External media still uses the existing
relink workflow. Normal workspace open/close keeps its existing behavior. Catalog
opening retains its existing migration path;
this feature adds no project fields, tables or schema version change.

HTTP exposes project-bound `GET /api/captions/context`,
`POST /api/captions/prepare`, `GET /api/captions/snapshot`,
`POST /api/captions/export`, and `GET /api/captions/file`. Prepare requires the
existing editor `baseRevision`. Export accepts only a stored snapshot ID and
`srt`/`vtt`, never caller-supplied cue text or filesystem paths. Downloads require
publication ID, owning project ID and `kind=captions|manifest`. Snapshot query
parameters expose the same four independent pagination pairs as the CLI.
Disconnect or server shutdown aborts preparation, publication and downloads, and
waits for cleanup. Snapshot, manifest and subtitle reads receive the same abort
signal, including checks before parsing or hashing their contents.
A project switch cannot close a catalog still in use by a caption request. A stale
response cannot update another Desktop project.

## Bounds and remaining limits

The mapper explicitly rejects oversized work: 10,000 selected clips, 100,000
segments/cues, one million clip/segment visits, 8 million output text characters,
20,000 characters per cue, or 100 hours of film time. It does not silently export
only an initial batch. Cached/receipt files are size-bounded and integrity checked.
Availability checks hash source files; large media may therefore take time, and
Cancel is available. No throughput or real-camera performance claim is made.
The application rejects unsupported track types and film durations before source
I/O, validates pagination before refreshing source status, checks clip count
before source I/O, and limits retained source text to 32 MiB of UTF-8 while reading pages. Historical word arrays remain in the
catalog and are not retained in caption working documents. A current catalog
page is still materialized; this is not a claim of a fixed process memory limit.
Sources used only by muted clips or clips without a millisecond of captionable
output, offline sources and renderer-ineligible media retain source/revision
bindings and explanatory warnings without loading their transcript segments into
that budget. The shared output-range check accounts for trim, speed and source-end
padding as well as the discarded sub-frame tail. Invalid source bounds, span/speed
combinations and source durations do not load transcript content; they retain the
mapper's `TIMING_UNSUPPORTED` error instead of consuming the transcript budget.
A source used by an audible, retained clip is still loaded even when another
instance is muted or outside the output range.

Whole-segment omission can leave gaps when a trim cuts through a sentence. Refine
the transcript segment boundaries or the clip trim, then regenerate. This version
does not manufacture word alignment to fill those gaps. It also does not export
multiple subtitle sources together, add a composition caption track, style text,
or verify subtitle playback in Resolve. Those are separate potential slices.
