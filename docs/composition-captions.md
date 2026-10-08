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
- Use whole segments fully within a retained source range. Omit a boundary-cut
  segment with a specific warning instead of guessing retained words or including
  cut-out speech. Corrected text keeps segment timing and its stale-word warning.
  Estimated boundaries remain disclosed. Overlaps remain present and are reported.
- Round starts upward and ends downward to milliseconds so output never extends
  into removed audio. Warn/omit cues that round to zero duration. Crossfades use
  existing renderer semantics; frozen visual tails add no speech or cue offset.
- Application snapshots bind project, composition/editor revision, selected track,
  clip/source ranges, transcript revisions/source hashes and format options.
  Bounded preview pages include cue provenance and structured warnings. Changed
  composition/transcript/source makes the snapshot stale; regenerate before export.
- Unique project-owned export directories publish subtitle and manifest together
  through staging then rename. Cancellation/failure cleans staging; no arbitrary
  output path can replace media. Existing immutable outputs retain their original
  receipt and are never silently relabeled as the newest cut.
- Desktop, HTTP and CLI call the same application service. Desktop responses and
  downloads are project-bound, with disposed/delayed requests ignored. The UI
  presents text/time preview, not a burn-in or final-player claim.

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
   The publication is an immutable copy. If the film, source or transcript has
   changed, regenerate the preview; an old snapshot cannot publish as current.
5. Keep the adjacent `manifest.json` with the subtitle. It records the project,
   composition revision, clip timing/speed/ranges, transcript revisions and
   provider provenance, warnings, and output SHA-256.

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
pnpm cli captions export <snapshot-id> --project /path/film.openfilm --format srt
pnpm cli captions export <snapshot-id> --project /path/film.openfilm --format vtt
```

Commands return JSON; publication `relativePath` is under the chosen project.
Each export creates its own `exports/captions-<id>/` directory containing the
subtitle and `manifest.json`. Re-running never replaces an existing output.
Snapshots remain in `cache/captions/` and can be read after reopening. Cancellation
or a failed staged write publishes neither file; a successful output whose HTTP
acknowledgement was lost is still a complete immutable publication, not a partial
file. A retry creates another copy. No timeline Undo step is added.

The CLI uses `OpenFilmApplication.openForExport`: no automatic job recovery,
media-reference rewrite or project save on close. Normal workspace open/close
keeps its existing behavior. Relocated managed media should first be opened and
relinked in the workspace. Catalog opening retains its existing migration path;
this feature adds no project fields, tables or schema version change.

HTTP exposes project-bound `GET /api/captions/context`,
`POST /api/captions/prepare`, `GET /api/captions/snapshot`,
`POST /api/captions/export`, and `GET /api/captions/file`. Prepare requires the
existing editor `baseRevision`. Export accepts only a stored snapshot ID and
`srt`/`vtt`, never caller-supplied cue text or filesystem paths. Downloads require
publication ID, owning project ID and `kind=captions|manifest`. Disconnect aborts
preparation/publication. A stale response cannot update another Desktop project.

## Bounds and remaining limits

The mapper explicitly rejects oversized work: 10,000 selected clips, 100,000
segments/cues, one million clip/segment visits, 8 million output text characters,
20,000 characters per cue, or 100 hours of film time. It does not silently export
only an initial batch. Cached/receipt files are size-bounded and integrity checked.
Availability checks hash source files; large media may therefore take time, and
Cancel is available. No throughput or real-camera performance claim is made.

Whole-segment omission can leave gaps when a trim cuts through a sentence. Refine
the transcript segment boundaries or the clip trim, then regenerate. This version
does not manufacture word alignment to fill those gaps. It also does not export
multiple subtitle sources together, add a composition caption track, style text,
or verify subtitle playback in Resolve. Those are separate potential slices.
