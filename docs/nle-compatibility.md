# NLE interchange status

OpenFilm prepares an OTIO cut layout with source file URLs, source trims, still
holds, audio, gaps and separate tracks. The official OpenTimelineIO 0.18.1 parser
accepts the file and preserves its structure through read/write/read. **DaVinci
Resolve is not installed in the verification environment; actual Resolve import
and playback have not been verified.** Parser success does not establish NLE
compatibility.

The Desktop Resolve card reads the browser-safe capability model in
[`packages/exporters/src/compatibility.ts`](../packages/exporters/src/compatibility.ts).
Each feature records implementation level, schema/parser validation, real NLE
verification, manual recreation and unsupported state separately. Its real-NLE
evidence list is empty. Export-specific reports additionally list the effects
actually present in that cut; a plain-cut export does not falsely request speed
or transform recreation. Updating real QA requires both evidence and the model,
not a translated UI claim.

The Global Product Experience preflight rechecked repository, PR #1 and accessible
workspace artifacts at candidate `239436cf672be287dbaec4dd9771165609d1d061`.
Only generated fixtures and official-parser results exist; no actual Resolve QA
record, `.drp`/`.dra`, import screenshots or application test results were found.
The 2026-10-06 application preflight also confirmed that the current cloud
environment has neither Resolve nor exposed GPU devices or a graphical session.
The actual application check is blocked there, not passed. The manual gate
therefore remains open. Use [the QA record](resolve-qa-record.md)
to record each capability independently when application testing is performed.

Advanced edits are **metadata only**, a known implementation limit. Speed,
volume/mute, scale, rotation, position, incoming crossfades, titles and clip locks
are retained exactly in OpenFilm metadata and must be recreated manually in the
NLE. They are not native OTIO effects. Export returns explicit warnings, and the
application writes an adjacent `.otio.report.json` compatibility report, including
current missing/inaccessible-source warnings. The edit compatibility portion is
also embedded in the OTIO document so it remains available with the file.

| Feature                                              | Implemented                                                                                             | Schema-valid                                           | Official parser read/write/read                               | Real NLE verified                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------ |
| Video cuts and source in/out at 1x                   | Native OTIO clip ranges                                                                                 | Yes                                                    | Yes, checked against generated source duration                | No — Resolve manual gate                                     |
| Still-image holds                                    | External image reference with explicit hold duration                                                    | Yes                                                    | Yes                                                           | No — verify Resolve still duration/interpretation            |
| Separate audio and music tracks                      | Native Audio tracks and source trims                                                                    | Yes                                                    | Yes                                                           | No — check routing and levels                                |
| Gaps, record offsets and multiple video/audio tracks | Native Gap/Track/Stack                                                                                  | Yes                                                    | Yes, each track and total duration checked                    | No — verify layer and channel mapping                        |
| Fractional project frame rate                        | RationalTime at 30000/1001                                                                              | Yes                                                    | Yes, seconds and rates preserved                              | No — check rounding/subframe behavior                        |
| Current file URLs and source identity                | ExternalReference plus asset ID/hash/reference metadata                                                 | Yes                                                    | Yes; real files, hashes and FFprobe bounds checked separately | No — relink on another machine if needed                     |
| Constant speed                                       | Original speed and full source range in metadata; native unretimed excerpt and, for slow clips, padding | Metadata yes; native retime not implemented            | Exact original fields and reserved slot verified              | Not implemented as an NLE effect; manual recreation required |
| Volume and mute                                      | Metadata only                                                                                           | Metadata yes; native audio gain not implemented        | Original values verified                                      | Manual recreation required                                   |
| Scale, rotation and position                         | Metadata only                                                                                           | Metadata yes; native transforms not implemented        | Original values verified                                      | Manual recreation required                                   |
| Incoming crossfade                                   | Metadata only; exported layout uses cuts                                                                | Metadata yes; native transition not implemented        | Original transition type/duration verified                    | Manual recreation required                                   |
| Generated title and overlay/title-track behavior     | Metadata only over a native Video cut track                                                             | Metadata yes; native title/compositing not implemented | Original title, transform and track type retained             | Manual recreation required                                   |
| Clip lock and beat identity                          | Metadata only                                                                                           | Yes                                                    | Preserved                                                     | Reapply locks/organization manually                          |
| Within-track overlapping clips                       | Rejected with an actionable error                                                                       | Not exported                                           | Not applicable                                                | Not claimed                                                  |
| FCPXML / EDL advanced effects                        | Rejected; no expansion in this round                                                                    | Existing limited formats only                          | Existing XML/resource checks retained                         | Not claimed                                                  |

“Schema-valid” here means the official library recognizes and deserializes the
standard OTIO schema objects used by the exporter. No separate Resolve-specific
schema validator or Resolve application was run.

## How metadata-only retimes preserve the cut layout

OTIO's `LinearTimeWarp` does not change `Clip.duration()` or track layout in the
official parser. Emitting it without a verified consumer contract could preserve
a JSON effect while changing record timing or source interpretation. This version
therefore emits no native retime or dissolve effect.

For a 2x edit of source 1–3 seconds into a one-second slot, the native cut references
source 1–2 seconds for that slot. Metadata still contains the exact original
source 1–3 seconds, speed 2 and the one-second timeline duration. To reproduce the
OpenFilm edit, use the full original source range and apply the 2x speed manually.
The exported native source-out is intentionally different and is reported.

For a 0.5x edit of source 2–3 seconds into a two-second slot, the native cut holds
one unretimed second followed by a one-second Gap named `Retime padding for
<clipId>`. This keeps later cuts at the same record times without inventing frames
past the source. Recreate the two-second retimed clip and replace the labeled gap
without rippling later clips. Still-image holds keep their timeline duration;
no video padding is required for a still.

Original data locations are:

- Timeline `metadata.openfilm.composition`: the complete original composition.
- Each Clip's `metadata.openfilm.clip`: exact original source/timeline fields,
  transform, transition, title, lock and beat ID.
- Timeline `metadata.openfilm.compatibility`: warnings and the affected clip IDs.
- Padding Gap `metadata.openfilm`: owning clip ID, reason, record start and length.

A consuming NLE may ignore or discard custom metadata during its own export.
Retain the original `.otio`, `.otio.report.json` and OpenFilm project alongside the
NLE project. The original OpenFilm timeline is not reconstructed from a generic
NLE round trip in this version.

## Reproducible parser and source gate

Install the pinned official `opentimelineio==0.18.1` package in an isolated Python
environment, with FFmpeg/FFprobe available, then run:

```sh
OPENFILM_OTIO_PYTHON=/path/to/venv/bin/python pnpm test:interchange
OPENFILM_OTIO_PYTHON=/path/to/venv/bin/python pnpm test:interchange --output /path/to/empty/resolve-reference
```

The optional output retains a reviewable CC0 bundle: generated real PNG/MP4/WAV
sources, `cuts.otio`, `edited.otio`, `fractional.otio`, compatibility reports,
officially reserialized round-trip files, and an expected-source/timeline manifest.
The ordinary command removes its temporary artifacts after verification.

The gate verifies actual source URLs including spaces, `#` and Unicode filenames,
SHA-256 identities, FFprobe durations, native source bounds, original metadata,
clip count, track kind, source in, record start, still hold and clip duration,
retime padding, gaps and total duration. It independently rejects a temporarily
missing source even when the OTIO file itself parses. Originals are restored and
rehashed afterward. Generated fixtures are synthetic evidence, not real-camera
or Resolve playback evidence.

## Manual Resolve import procedure

1. Generate the retained reference bundle above and record the Resolve version,
   operating system and project frame rate. Make a separate Resolve project;
   retain the OpenFilm files unchanged. Save the compatibility report with the QA
   record.
2. Set the cut-reference project to **24 fps**, then import `cuts.otio` through
   Resolve's timeline import UI if that installed
   version offers OTIO. If the version does not support it, record the limitation;
   do not infer OTIO support from another interchange format. Relink the `media
files` folder if the bundle moved between machines.
3. Compare the timeline against `manifest.json`: four tracks, all six source
   clips, 12-second total duration, one-second initial still offset, two-second
   source-trimmed main video at record 5 seconds, closing still at 9 seconds,
   second video at 2 seconds, and the audio/music ranges. Check every source-in,
   source-out, gap, layer and audio routing. Inspect the first and last frame of
   each video edit and verify still holds visually.
4. Import `fractional.otio` into a project set to 30000/1001. Record whether Resolve
   preserves or rounds the deliberately fractional frame positions; compare both
   seconds and frame numbers. Parser timing preservation is not a promise about
   a consumer's frame-grid rounding.
5. Import `edited.otio` separately. Read every warning before comparing playback.
   Recreate speed using the original source range, replace any labeled retime
   padding without ripple, set volume/mute, transforms and title, and recreate
   transitions. OpenFilm's crossfade uses its incoming fade semantics; compare
   against a rendered OpenFilm reference instead of assuming Resolve's default
   centered dissolve is identical. Reapply locks as desired.
6. Save and reopen the Resolve project. Check source availability, timing, muted
   audio, overlays, color interpretation and the manually recreated effects. If
   testing export back to OTIO, use a separate output and compare against the
   retained original; log any custom metadata lost by Resolve.
7. Attach screenshots of the source properties and timeline, measured timing,
   compatibility reports and the Resolve project to the QA record. Mark each
   feature verified only after this procedure succeeds. No such result is claimed
   by the automated gate.
