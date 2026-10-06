# Vidscribe reference and OpenFilm 0.3 adaptation

This is a source review, not a claim that Vidscribe was installed or its model,
GPU, subtitle export, or face detection was exercised in this environment.

The reviewed repository is [AinxietyLab/VidScribe](https://github.com/AinxietyLab/VidScribe)
at commit **`b145eaf1f7ae8f52588375e6d1e06e1ee58e3867`**. The local read-only
checkout was `/tmp/openfilm-vidscribe-reference`. The review used the pinned
[`README.md`](https://github.com/AinxietyLab/VidScribe/blob/b145eaf1f7ae8f52588375e6d1e06e1ee58e3867/README.md),
[`SPEC.md`](https://github.com/AinxietyLab/VidScribe/blob/b145eaf1f7ae8f52588375e6d1e06e1ee58e3867/SPEC.md),
and source files listed below. OpenFilm's implementation baseline for this work
is `b9273d6d369a3c4f6eb348c3a34f9ccbd7e76b1b`.

## Scope and licensing

Vidscribe is a local subtitle editor for one source recording. OpenFilm is a
story-driven editor containing many original assets, beats and timeline clips.
We are independently implementing selected capabilities against OpenFilm's
catalog, source identity, jobs and timeline commands. We are not copying the
reference's application architecture, code blocks, bundled model, assets or UI.

The pinned Vidscribe [license](https://github.com/AinxietyLab/VidScribe/blob/b145eaf1f7ae8f52588375e6d1e06e1ee58e3867/LICENSE)
is MIT, copyright 2026 VidScribe contributors. Its notice must accompany copies
or substantial portions if any are introduced later. OpenFilm remains
Apache-2.0. The reference describes its bundled YuNet model as Apache-2.0;
that comment is not a substitute for checking model provenance and distribution
terms before any future adoption. No reference model is being bundled here.

“Adopt” below means adopt an interaction or constraint through independent code;
“Adapt” means change the interaction to fit OpenFilm; “Defer” means outside the
0.3 P0 foundation; “Reject” means intentionally exclude that behavior.

## Capability, interaction and failure review

Paths are relative to the pinned reference repository. Implementation details
take precedence over earlier suggestions in `SPEC.md`.

| Reference and observed capability                                                                       | Interaction and failure behavior                                                                                                                                                                                                                                              | Decision for OpenFilm                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/transcriber.py`: FFmpeg extracts mono 16 kHz PCM; faster-whisper returns segments and words.   | A project job records extraction, model loading, transcription, conversion and completion. One process-wide transcription lock serializes inference; repeated starts for one project are refused. Exceptions become persisted error text.                                     | **Adapt.** Analyze a catalog asset through OpenFilm jobs. Keep provider/model/source provenance and word timing separate from user timeline edits. P0 transcript is read-only and can seek the source.                 |
| `backend/transcriber.py`: CUDA float16 initialization and CPU int8 fallback.                            | Failed CUDA initialization permanently selects CPU for the process; inference failure on CUDA retries on CPU once. Model loading may download weights.                                                                                                                        | **Adapt.** Report actual local provider/model availability and requested versus actual execution. Missing dependencies or models must be actionable. No automatic model download or GPU-success claim from a CPU test. |
| `backend/transcriber.py`: Chinese conversion and dictionary post-processing.                            | OpenCC `s2twp` changes segment text and word strings when detected language starts with `zh`; dictionary replacement changes segment text. Original transcription is backed up before replacing saved subtitles.                                                              | **Defer** conversion and dictionary editing. Preserve provider output and explicit transcript language; interface locale must not silently rewrite recognized text.                                                    |
| `backend/waveform.py`: 50 peak samples per second from extracted PCM, with atomic file replacement.     | The implementation reads all PCM samples into memory. Waveform failure during transcription is logged without failing transcription.                                                                                                                                          | **Adapt.** Waveform is an independent bounded, cached artifact. Do not require successful transcription to inspect sound or edit a clip. Empty/no-audio and processing failure remain distinct.                        |
| `backend/cuts.py`: FFmpeg scene score threshold `0.3` after scaling to width 320.                       | A separate job rejects missing sources, audio-only projects and duplicate running detection. A one-hour subprocess timeout becomes an error; temporary diagnostic output is removed. Saved cuts are reused.                                                                   | **Adapt.** Persist source-time scene suggestions with detector provenance and source validation. Suggestions can assist snapping; they do not automatically split the film or imply semantic scene understanding.      |
| `frontend/src/Waveform.tsx`: viewport canvas peaks, zoom and follow-playhead.                           | Only the visible waveform range is drawn. Zoom preserves the time at the viewport center. Following respects reduced-motion preferences.                                                                                                                                      | **Adopt** bounded drawing, explicit zoom and follow controls. Keep source-time precision views separate from composition-time story layout.                                                                            |
| `frontend/src/Waveform.tsx`: drag either subtitle edge or the whole segment.                            | Pointer capture tracks a provisional drag. Only pointer release commits changed times, so one drag becomes one undo operation. A minimum interval prevents inverted bounds.                                                                                                   | **Adapt.** Drag source trim handles, preview locally, then submit one validated timeline command through the existing autosave/history path. Respect source bounds, speed and locked clips.                            |
| `frontend/src/Waveform.tsx`: snapping to nearby marks, detected cuts and adjacent subtitle edges.       | The threshold is eight display pixels converted to seconds using current zoom; the nearest eligible point wins. Marks are inserted by double-click and removable by double-click.                                                                                             | **Adapt.** Offer explicit marker controls and visible snap state; use deterministic source-time candidates and a zoom-aware tolerance. Markers must have stable asset identity and persisted IDs.                      |
| `frontend/src/Waveform.tsx`: paused hover scrubbing, blank-area click seeking, drag-to-create subtitle. | Moving the pointer while paused seeks through animation frames; a blank drag can create a subtitle interval.                                                                                                                                                                  | **Adapt** paused hover scrubbing and explicit seek within the Precision source view; **reject** drag-to-create transcript content for P0. Transcript cues remain read-only.                                            |
| `frontend/src/Editor.tsx`: split, merge, undo/redo, keyboard navigation and autosave hooks.             | `B` splits a subtitle at playback time; text Enter/Backspace operate on subtitle text. Shortcuts avoid selects, open menus, dialogs and side panels.                                                                                                                          | **Adapt.** Split a selected timeline clip at the source playhead using shared timeline commands; avoid intercepting input/navigation keys. Do not reinterpret transcript edits as timeline mutations.                  |
| `frontend/src/Editor.tsx`: mutually exclusive visible panel dock.                                       | Hidden panels stay mounted so switching panels preserves drafts; dialogs and task failures remain visible without native blocking alerts.                                                                                                                                     | **Adopt** preserving state during mode switches and clear jobs/errors. Precision mode must retain access to the source player and inspector at supported desktop sizes.                                                |
| `backend/dictionary.py`: global wrong-to-right replacement list.                                        | Duplicate wrong forms replace older entries. Empty/identical pairs are rejected; longer strings are replaced first. Malformed or missing dictionary data reads as an empty list.                                                                                              | **Defer.** A future transcript-editing contract needs undo, authored-text provenance, language scope and word-alignment rules before replacement is exposed.                                                           |
| `backend/llm.py`: optional Claude CLI proofreading.                                                     | Sends indexed text without timestamps, validates returned indices and nonempty changes, exposes review suggestions, retries a failed batch once. Cancellation is checked between batches; a running batch has a timeout. Failed persistence can leave results only in memory. | **Defer.** No LLM calls, subscriptions or proofreading UI in P0. Future suggestions must be explicitly reviewed and must never mutate source or timeline timing.                                                       |
| `backend/clips.py`: optional transcript-based short selection.                                          | Validates row ranges, duration and scores, removes overlap, and allows preview/adjustment. Cancelling LLM analysis kills its subprocess; cancelling later face alignment keeps expensive completed selection results.                                                         | **Defer.** OpenFilm's story scope and protected clips remain authoritative; no automatic “best moments” claim from transcript timing alone.                                                                            |
| `backend/clipgeo.py`: single 9:16 crop and stacked face/content crop geometry.                          | Pure calculations clamp crop placement and round output geometry for chroma alignment; shared fixtures coordinate preview/export geometry.                                                                                                                                    | **Defer** reframing UI; **adopt** the principle that preview and rendered transforms need shared deterministic geometry tests when implemented.                                                                        |
| `backend/face_detect.py`: optional OpenCV YuNet sampled face positioning.                               | Samples up to nine frames, requires a minimum hit ratio and aggregates median position. Missing dependencies disable availability; no detected face leaves centered framing. Cancellation is checked between work items. It is not frame-by-frame tracking.                   | **Defer.** No face model distribution, tracking, face recognition or subject-aware framing claim in P0.                                                                                                                |
| `frontend/src/SafeFrame.tsx`: aspect presets and platform occlusion hints.                              | Fits overlays to actual displayed video content, excluding letterbox bars; presets include approximate player/UI zones.                                                                                                                                                       | **Defer.** Platform zones are guidance, not guaranteed platform layouts. Future overlays must follow the actual rendered source rectangle.                                                                             |
| `frontend/src/SubtitleOverlay.tsx`: subtitle preview and per-segment placement.                         | A drag pauses playback and writes only changed axes on release. Shared geometry matches burn-in layout; short previews can highlight words.                                                                                                                                   | **Defer.** P0 transcript navigation is not subtitle authoring, burn-in, karaoke or subtitle export. Do not display word timing as a claim of recognition accuracy.                                                     |

## Boundaries carried into the foundation

Analysis is optional. Import, Story mode, normal trim, preview and export must
remain usable without Python, Whisper weights, OpenCV, a GPU or an LLM service.
The local audio/video source and its fingerprint determine artifact validity;
changing or relinking a source must not silently attach stale analysis to new
bytes. Analysis completion must not rewrite user edits or manufacture new story
content.

OpenFilm's job system owns cancellation, timeout and errors rather than copying
per-feature thread dictionaries from the reference. A cancelled or failed job
must not publish a partial artifact as a completed transcript/waveform/scene
result. Reopening a project must distinguish persisted valid results from stale
or unavailable source data. Source files remain untouched.

Transcription language, film-content language and interface language serve
different purposes. A language change in the UI must neither rerun transcription
nor translate a saved transcript. Availability must disclose optional local
dependencies rather than hiding an unexplained unavailable action.

## Evidence and non-claims

The source review above establishes design input only. Current OpenFilm behavior
and verification are recorded separately in `media-intelligence.md`,
`transcription.md`, `precision-editing.md` and `markers-and-snapping.md` as the
foundation lands.

A deterministic test provider can exercise job orchestration, stored word
timing, paging, seeking, cancellation and UI state. It does **not** establish
speech-recognition quality or a successful real Whisper run. An optional actual
CPU Whisper test must record its installed provider, model, execution mode and
fixture provenance separately. GPU availability or performance requires an
actual compatible GPU run. None of these checks establishes DaVinci Resolve
application compatibility.
