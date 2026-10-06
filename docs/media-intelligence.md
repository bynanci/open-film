# Media intelligence foundation

OpenFilm 0.3 adds optional analysis of original audio/video sources: timed
transcripts, audio waveforms, detected scene cuts and manual source markers.
Analysis helps navigate and trim a film. It does not choose the story, rewrite
authored text, or change a timeline merely because a job completes.

The capability review and independent implementation boundaries are recorded in
[vidscribe-reference.md](vidscribe-reference.md). Transcription setup is in
[transcription.md](transcription.md); editing and marker behavior are in
[precision-editing.md](precision-editing.md) and
[markers-and-snapping.md](markers-and-snapping.md).

## Stored results and source identity

The additive Core contracts are `TranscriptDocument`, `TranscriptSegment`,
`TranscriptWord`, `WaveformData`, `TimelineMarker` and `SceneAnalysis` in
`packages/core/src/intelligence.ts`. Times are finite nonnegative seconds in the
original media, not positions in a composed film. Validation checks segment and
word ordering, interval bounds, IDs and optional confidence values. Supplied
source duration also limits result times.

Derived results live in SQLite catalog tables introduced by catalog schema
version 2. Large transcripts are stored as indexed segment rows and read in
pages. They are not embedded in every `MediaAsset` or in `project.json`.
Waveforms and scenes have dedicated caches; manual markers have their own
source-bound rows. Catalog migration is transactional and preserves existing
assets, jobs, ratings and timeline data.

Analysis provenance includes provider ID, analysis format version, source hash,
creation timestamp and optional model/provider version. The source hash binds
results to bytes, not just a filename. The application checks the actual source
before analysis and again before committing a result. Changed sources require
reimport/reconnection; a result from old bytes must not be attached to new ones.
Moving the same original bytes can preserve source-bound analysis. Waveform and
scene reuse also requires the current provider, analysis version and algorithm
identity; a cache from an older pipeline is hidden and recomputed on request.
Transcripts retain their recorded provider/model provenance as revisions.
Originals are never modified by these operations.

## Local processing

Waveforms and scene cuts use local FFmpeg. Waveforms stream decoded PCM and combine channel peaks
rather than buffering the entire recording. Peaks begin at 50 bins per second
and are combined as needed to keep at most 20,000 bins. `sampleRate` describes
the resulting peak bins per second, not the source audio sample rate. Source
timestamps, including short packet gaps, are preserved in both waveform and
transcription audio preparation. Precision plots bins using this rate; a partial
final bin does not stretch earlier audio positions.

Scene detection uses FFmpeg's visual change score with a default threshold of
0.3. Results are source-time `scene-cut` suggestions with confidence and detector
provenance. They are not semantic scene labels or instructions to split clips.
Audio-only material cannot produce visual cuts. Audio/video with no audio track
cannot produce an audio waveform or transcript.

Transcription is a provider capability. The bundled adapter invokes an optional
local faster-whisper installation and a user-configured local model. A model is
not bundled or automatically downloaded. Editing, waveform and scene tools do
not require successful transcription. No remote provider or LLM is enabled by
this foundation.

## HTTP boundary

All routes operate on the currently open project and catalog-owned asset IDs.

| Request                                               | Result                                                                                                                                                   |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/intelligence/providers`                     | Local transcription provider, supported capabilities and availability.                                                                                   |
| `GET /api/assets/:id/intelligence?offset=0&limit=100` | Source hash, one transcript page with total/offset, waveform, scenes and stored source markers. The default is 100 segments; the maximum request is 200. |
| `POST /api/assets/:id/intelligence`                   | Start a job with `{ operation: "transcribe" \| "waveform" \| "scenes", language?, execution? }`; returns HTTP 202 and a job.                             |
| `POST /api/assets/:id/markers`                        | Add a manual source marker using `{ time, label? }`.                                                                                                     |
| `DELETE /api/assets/:id/markers/:markerId`            | Remove that source's manual marker.                                                                                                                      |

Transcription language accepts `auto`, `zh`, `en`, `ja`; execution accepts
`auto`, `cpu`, `gpu`. Browser requests cannot supply arbitrary executable or
model paths. Invalid requests and missing assets are rejected before analysis;
an active project job prevents another conflicting analysis from starting.

The existing jobs API carries progress, stages and cancellation. Processing
failure is reported on the job with a stable semantic code, localized primary
message and optional technical detail. Failed or cancelled runs do not publish
partial results as complete. A previously committed valid result can remain
available when a later attempt fails. Job completion and artifact validity are
separate facts: changing the original afterwards invalidates the old result.

## Verification boundaries

Core/catalog tests cover data validation, migration, paging and persistence.
Media tests use generated local sources to check real FFmpeg waveform/scene
processing. HTTP integration checks cover job lifecycle, cancellation,
source changes and project reopening. Precision browser coverage uses the real
server, importer, catalog, FFmpeg and shared edit autosave path.

A clearly identified protocol fixture may stand in for an optional speech model
in browser tests. Such a run proves orchestration and timing interactions, not
speech-recognition accuracy. Any actual Whisper CPU or GPU evidence must be
recorded separately with model/runtime details; neither source review nor a
fixture transcript is evidence of model execution.
