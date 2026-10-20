# Creative Scene Platform

This roadmap adapts the product goals to the current `main` source tree. The
checked-in `TASKS.md`, `ROADMAP.md`, README and architecture documents do not
define an F01–F13 catalogue; the crosswalk below is a new planning aid, not a
claim that these labels were previously accepted or completed. Status describes
the behavior present in `main` at M7A integration base
`bb2c4521ad894478893485119442a00ffd9b34cc`. M1–M6 and M7A are integrated; M7A
merged through PR #34. M7B Export Formats remains an open candidate PR (#36)
with unresolved code-review findings. M7D is the current independent candidate;
its local evidence and workstation gates are recorded in
`docs/validation-collect-media.md`.

define an F01–F13 catalogue; the crosswalk below is a planning aid, not a claim
that these labels were previously accepted or completed. M1–M6 are integrated
on current `main`. M7A Named Versions merged as PR #34 at
`bb2c4521ad894478893485119442a00ffd9b34cc`. M7B Export Profiles is in
implementation on a separate branch and is independent of the still-open M8A
PR #35. See the exact validation records for each milestone's evidence and
remaining gates.

## Capability gap crosswalk

| ID  | Capability                                                    | Main status         | Evidence and gap                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01 | Local-first foundations and declarative GraphicScene (M3/F01) | Complete            | M3 is merged. Strict versioned scenes, pure arbitrary-seek evaluation, shared Monitor/FFmpeg raster and existing history are in `docs/graphic-scenes.md`.                                                                                                                  |
| F02 | Story-first creative templates on saved Composition           | Complete / M4       | Conversation, route and photo-relationship templates build editable GraphicScene v1 primitives; exact source identity stays in optional Composition metadata (`docs/creative-story-templates.md`). Merged in PR #29.                                                       |
| F03 | Dynamic scene motion and reusable layer editing               | Complete / 5A       | Photo motion and GraphicScene enter/exit animation plus direct layer selection/transforms, snapping, guides, keyboard controls and lock-aware typed edits are integrated in PR #30.                                                                                        |
| F04 | Native caption track and transcript provenance                | Implemented in M2   | Merged M2 adds stable versioned cues, Edit controls, transcript provenance and MP4 burn-in alongside existing SRT/WebVTT output.                                                                                                                                           |
| F05 | Photo narrative and measured title workflows                  | Partial             | M4 adds editable photo relationships and explicit focus protection; broader measured framing, automatic narrative selection and private-film aesthetics remain open.                                                                                                       |
| F06 | Music, narration and sound design                             | Partial / M6        | Overlay music/narration, fades, gain and manual ducking render; decoded mix review and production audio evidence remain queued for M6.                                                                                                                                     |
| F07 | Saved-revision Visual QA and timestamped contact sheets       | Implemented in M1   | M1 adds a shared saved-revision QA report/contact sheet through Application, Desktop, API and CLI, with typed findings and Edit navigation. PR #27 is merged after exact-head media/native CI; M3 extends findings to graphic-only images/text.                            |
| F08 | AI-assisted creative edits                                    | Partial / 5B        | Local speech recognition, optional text suggestions and bounded scene-direction commands exist. PR 5B adds selected-layer reviewable operations, ProviderRegistry/consent and deterministic local commands; provider generation is bounded and outside the mutation queue. |
| F09 | Non-destructive edit safety and recovery                      | Complete foundation | Source-preserving edits, locks, serialized save contracts, autosave, bounded history, cancellation and reopen coverage are present.                                                                                                                                        |
| F10 | FFmpeg output and verifiable provenance                       | Partial / M6        | Real MP4 rendering, source/font hashes, warnings, FFprobe and interchange evidence exist; M1 binds sampled-frame reports to a saved revision. Expanded output evidence is queued for M6. Hardware, 4K and real NLE finishing remain manual.                                |
| F11 | Shared application logic across entry points                  | Complete foundation | Desktop and CLI use `@openfilm/application`; loopback HTTP adapts the same services. New QA behavior must remain behind that boundary.                                                                                                                                     |
| F12 | Privacy, security, licensing and accessible localized UX      | Partial             | Apache-2.0/NOTICE, local-only sources, API guards, project-local caches, three locales and keyboard-tested Edit controls exist. QA images and reports still need explicit cache isolation, path-safe serving and localized keyboard navigation.                            |
| F13 | Reproducible validation and real-world release evidence       | Partial             | Synthetic media, actual FFmpeg regressions and manual Resolve/workstation gates are documented. Hardware, private-film quality, camera, 4K and NLE sign-off cannot be inferred from fixture success.                                                                       |

## M7 delivery route

The M7 sequence packages project recovery and delivery capabilities as separate
changes. Each item requires its own exact-base/head evidence; completing M7A
does not complete the remaining M7 work.

| PR  | Scope                      | Dependency and acceptance                                                                                                                                                                                                                                                     |
| --- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7A  | Named Versions (merged)    | Merged through PR #34. Existing project/catalog writer contracts; immutable manifest + SQLite snapshot, structured diff, confirmed checkpointed restore, CLI/API/Desktop parity, reopen and actual synthetic MP4 evidence. See [validation](../validation-named-versions.md). |
| 7B  | Export Formats (candidate) | Open PR #36. Reuse Composition/render state; still PNG, WAV/stems and 16:9 / 9:16 / 1:1 presets without rewriting source framing or composition intent. Unresolved review findings remain.                                                                                    |
| 7C  | NLE Fidelity (queued)      | Classify each edit native editable, metadata-only, baked or unsupported; report compatibility and make pre-rendering optional and explicit.                                                                                                                                   |
| 7D  | Collect Media (candidate)  | Current independent M7D work. Collect only referenced media/dependencies with rights, hashes, path safety, ZIP validation and relocation/reopen; exclude credentials/private paths. See [contract](../collect-media.md) and [validation](../validation-collect-media.md).     |
| 7E  | Native Installer (queued)  | Tauri/service/FFmpeg/font packaging and update/rollback; require separate Windows and macOS workstation evidence.                                                                                                                                                             |

| PR  | Scope                        | Dependency and acceptance                                                                                                                                                                                                                                         |
| --- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7A  | Named Versions (candidate)   | Existing project/catalog writer contracts; immutable manifest + SQLite snapshot, structured diff, confirmed checkpointed restore, CLI/API/Desktop parity, reopen and actual synthetic MP4 evidence. See [validation](../validation-named-versions.md).            |
| 7B  | Export Formats (queued)      | Reuse Composition/render state; still PNG, WAV/stems and 16:9 / 9:16 / 1:1 presets without rewriting source framing or composition intent.                                                                                                                        |
| 7C  | NLE Fidelity (queued)        | Classify each edit native editable, metadata-only, baked or unsupported; report compatibility and make pre-rendering optional and explicit.                                                                                                                       |
| 7D  | Collect Media (queued)       | Collect only referenced media/dependencies with hashes, license/path safety, ZIP validation and relocation/reopen; exclude credentials.                                                                                                                           |
| 7E  | Native Installer (candidate) | M7E adds verified runtime staging, private owned startup/shutdown and candidate packaging; distribution inputs and Windows/macOS workstation evidence remain pending. See [contract](../native-installer.md) and [validation](../validation-native-installer.md). |

M8A selective 2.5D photo motion is a separate candidate stacked on M7A PR #34's
exact head `92330127f01c934da0235c56d3fbef4b159bcaf3`. It extends GraphicScene

| PR  | Scope                         | Dependency and acceptance                                                                                                                                                                                                                                          |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 7A  | Named Versions (merged #34)   | Existing project/catalog writer contracts; immutable manifest + SQLite snapshot, structured diff, confirmed checkpointed restore, CLI/API/Desktop parity, reopen and actual synthetic MP4 evidence. See [validation](../validation-named-versions.md).             |
| 7B  | Export Profiles (in progress) | Reuse Composition/render state; actual-frame preview, still PNG, aligned WAV/stems and 16:9 / 9:16 / 1:1 presets without rewriting source framing or composition intent. See [contract](../export-profiles.md) and [validation](../validation-export-profiles.md). |
| 7C  | NLE Fidelity (queued)         | Classify each edit native editable, metadata-only, baked or unsupported; report compatibility and make pre-rendering optional and explicit.                                                                                                                        |
| 7D  | Collect Media (queued)        | Preview selected-use collection; package referenced media/dependencies with rights, hashes, controlled relative paths and SQLite-safe snapshots; verify archive safety, relocation, reopen, preview and real MP4 without original external URIs.                   |
| 7E  | Native Installer (queued)     | Tauri/service/FFmpeg/font packaging and update/rollback; require separate Windows and macOS workstation evidence.                                                                                                                                                  |

M8A selective 2.5D photo motion is a separate open PR #35 based on current
`main` at `bb2c4521ad894478893485119442a00ffd9b34cc`. It extends GraphicScene
with a local hash-bound alpha mask, optional background fill, bounded deterministic
camera motion, explicit fallback and typed Visual QA/manual-review findings. It
does not add another timeline or use remote image generation. The full automated
matrix and decoded synthetic MP4 evidence passed; independent PR review and
stacked CI are pending. Real-photo/4K/workstation gates remain separate. See

latest-main CI are pending. One TypeScript/media check remains in progress.
Real-photo/4K/workstation gates remain separate. See
[`PhotoDepth validation`](../validation-photo-depth.md); M7A itself does not
contain this feature.

## Dependencies and PR route

```text
Saved Composition + existing editor revision
                  │
                  ▼
M1 / F07  Shared Visual QA application service
          ├── FFmpeg render and source/font evidence
          ├── typed issues + timestamped frames/contact sheet
          ├── private project cache + stale/cancel/retry guards
          └── API / CLI / Desktop Edit integration
                  │
                  ├── M2 / F04  native caption track and subtitle finishing (merged)
                  ├── M3 / F01  strict declarative GraphicScene (merged)
                  ├── M4 / F02  Creative Story Templates (merged PR #29)
                  ├── M5 / F03  Layer Editor (merged PR #30)
                  ├── M5 / F08  Reviewable Agent Editing (PR 5B on merged 5A)
                  └── M6 / F05,F06,F10,F13  photo/audio/output review and gates
```

| PR  | Milestone                                 | Scope and dependency                                                                                                                                                                                                    | Exit evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | M1 / F07 Visual QA                        | Merged PR #27 (`514a6f0`). Reuse saved Composition, `TimelineEditor` revision logic, `FFmpegRenderer`, project jobs and existing Edit monitor. Do not change project schema or add a timeline.                          | Synthetic-source real MP4; decoded timestamped frames; source/output hashes; typed missing/font/overflow/black-review issues; API/CLI/Desktop parity; stale, cancel/retry, project-isolation and keyboard/i18n tests.                                                                                                                                                                                                                                                 |
| 2   | M2 / F04 Native Caption Track             | Merged PR #26. Extends the saved Composition contract and existing editor/renderer/transcript mapper; do not add a second timeline or infer word alignment.                                                             | Synthetic narration MP4 with decoded CJK timing/placement, exact SRT/VTT times, transcript/manual revision, stale and source-lock/history/reopen coverage.                                                                                                                                                                                                                                                                                                            |
| 3   | M3 / F01 Declarative GraphicScene         | Merged on the stated base. Versioned Image/Text/Shape/Group extends Composition; shared bounded raster serves Monitor and FFmpeg. No project code, remote URL or second timeline.                                       | Deterministic arbitrary-seek output, lock/history/reopen tests and explicit interchange limitations.                                                                                                                                                                                                                                                                                                                                                                  |
| 4   | M4 / F02 Creative Story Templates         | Extends the same GraphicScene contract with Conversation Card, Route Story and Photo Relationship records; GPX is explicitly selected, local, bounded and data-only. Merged in PR #29.                                  | Synthetic 20–30 second MP4, decoded section frames/times, source hashes, no fabricated route claims, browser/undo/lock/reopen and safe import coverage.                                                                                                                                                                                                                                                                                                               |
| 5A  | M5 / F03 Layer Editor                     | Merged PR #30 on integrated M3/M4 base `e6d07b0`; layer operations use existing typed scene commands, revision checks, lock state and history.                                                                          | Selection/drag/resize/rotate/opacity/z-order, hidden/locked, snapping/guides/keyboard, browser and actual-render regressions; exact-head CI passed before merge.                                                                                                                                                                                                                                                                                                      |
| 5B  | M5 / F08 Reviewable Agent Editing         | PR #31 implements the feature on merged 5A `a33340c`; ProviderRegistry/consent gates optional provider calls; deterministic local operations remain available. Proposals cannot mutate protected or unselected content. | Affected-ID and before/after review, conflicts, Preview → Select → Explicit Accept, persisted idempotency receipt before mutation, reload-safe edit barrier, keyboard history and direction-acceptance guards, prerequisite-aware proposal-order application, template-provenance validation, bounded cancellable provider API and actual MP4 regressions; implementation-source exact CI passed, with documentation-only rerun and manual gates recorded separately. |
| 6   | M6 / F05,F06,F10,F13 Audio and release QA | Depends on M1 evidence; adds decoded audio diagnostics and repeatable output evidence. Keep hardware, real media, 4K and NLE finishing as separate manual gates.                                                        | Actual decoded audio metrics, repeatable manifests, and separately recorded hardware/Resolve/4K manual gates.                                                                                                                                                                                                                                                                                                                                                         |

## M1 behavior contract

Visual QA snapshots the currently saved Composition and application revision,
renders through the existing FFmpeg adapter into a unique project-local cache
directory, probes the produced MP4, and extracts a bounded set of frames from the
decoded output. Each sample records the output frame index and exact composition
time (`frameIndex / frameRate`), dimensions and image hash. The report includes
the saved composition revision, output hash, and source IDs/hashes; it omits
source paths. No original file or project schema is modified.

Issues are structured domain data: `asset.missing`, `font.load-failed`,
`title.overflow`, and `visual.suspected-blank`. The last is advisory and requires
human review. A black or near-black frame is never an error by itself: the
report cannot infer whether a fade, title card or intentional black is wrong.
Other aesthetic judgments that cannot be measured are labelled manual review.
If a blocking render input is missing or a title cannot be laid out, the report
still preserves typed diagnostics and is marked incomplete; it does not invent
sample frames from a failed render.

Desktop starts and polls the same application job exposed by the HTTP adapter;
CLI calls the same application method. Cancelling removes partial QA outputs,
retry creates a fresh job/report identity, and project switching remains blocked
while work is active. A revision/source change detected before publication makes
the report stale and prevents it from being presented as current. Contact-sheet
images are served only from the active project's validated report directory.

## Risks and mitigations

| Risk                                                               | Mitigation                                                                                                                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Intentional black, fades or static cards are flagged               | Use a `manual-review` issue with no error severity; require the person to decide.                                                                             |
| Large/long compositions make frame extraction expensive            | Bound the sample count and extract selected decoded frames in one FFmpeg pass; cancellation reaches each child process.                                       |
| Source paths or private images leak through reports                | Store artifacts under a per-report private project cache; return hashes and opaque relative frame IDs, never absolute source paths; validate every read path. |
| A render completes for a no-longer-current edit                    | Bind report to the canonical saved revision and reject/discard stale publication after render and before each report read.                                    |
| A project is replaced during work                                  | Existing server lifecycle guard blocks switching while the owned job is active; request/job cancellation cleans partial output.                               |
| Render warnings are mistaken for measured artistic quality         | Keep typed machine checks separate from manual-review findings and existing human viewing/listening/NLE gates.                                                |
| Upstream reference code/assets introduce license or execution risk | Use only documented workflow concepts; no upstream code, marks, assets or project-authored JS/HTML are copied or executed.                                    |

The upstream design review was pinned to `openfilm/openfilm` main
`120193c63329c61ae2863dd681f6c5ed31b5a9bf`: `packages/openfilm/SPEC.md`,
`packages/openfilm/MANUAL.md`, `apps/desktop/src/studio.mjs`,
`packages/openfilm/src/render.mjs`, and `packages/openfilm/src/look.mjs`. The
useful ideas are timestamped contact sheets, deterministic sampled-frame
inspection, explicit job ownership/cancellation, and treating machine output as
evidence for a human. Their HTML/JS page renderer is not suitable for OpenFilm
projects and is deliberately outside this design.

## M1 acceptance matrix

| Area               | Acceptance                                                                                                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Revision           | Report references the saved Composition revision and project identity; edit/source mutation during QA cannot produce a current-looking stale report.                                                       |
| Render evidence    | Generate an actual H.264 MP4 from generated synthetic/CC0 media; probe dimensions/fps/duration/frame count; decode every selected frame and validate its timestamp.                                        |
| Provenance         | SHA-256 values for used sources and MP4 match fresh file hashes; source hashes are unchanged after QA. No source path appears in the public report.                                                        |
| Typed diagnostics  | Missing media, font loading/glyph failure, and measured title overflow have stable issue kinds and clip/time references.                                                                                   |
| Black / aesthetics | Legal black is not an error. Suspicious blank/black is manual review; aesthetic-only concerns are not presented as measured failures.                                                                      |
| Integration        | Application is the shared command path for API, CLI and Desktop. A Desktop issue/sample activates Edit and seeks/selects the corresponding clip/time.                                                      |
| Lifecycle/security | Cancel, retry, project switch, stale revision, malformed report ID and path traversal are covered; partial outputs are removed and private cache stays project-scoped. Project scripts/HTML are never run. |
| Compatibility      | Existing project contract/schema, lock/required selection, undo/redo, autosave/reopen, renderer behavior and Apache-2.0/NOTICE stay intact.                                                                |
| UX                 | English, Traditional Chinese and Japanese catalogs match; keyboard activation/focus and CJK-friendly timestamp/layout behavior are covered.                                                                |
| Manual gates       | Private-film aesthetics, monitor/projector, hardware performance, Resolve/NLE behavior and 4K are reported as manual/unrun unless actually performed.                                                      |

## M2 / F04 native caption contract and acceptance matrix

Caption cues are versioned Composition content with stable IDs, integer
millisecond ranges, literal text, provenance and a manual-revision counter.
Transcript-derived cues retain transcript/revision/segment/clip/source-range
identity and remain segment-aligned; word timing is never inferred. Manual text
and timing edits increment only the cue's manual revision. Existing transcript
documents remain untouched. The existing Composition command history provides
Undo/Redo, autosave, reopen and stale-revision protection.

Edit shows caption cues on a lane measured against the same Composition duration
used by visual clips. Its Inspector edits text/line breaks, start/end, font and
safe-area margins. Transcript import uses the shared Application caption snapshot
service and then the ordinary Composition command; stale snapshots are rejected.
Shortening that would exclude a saved cue is rejected before it enters the save
queue; users adjust or remove that cue explicitly. Temporary regeneration stages
are checked after the complete edit so unchanged or extended films remain valid.
The renderer uses the existing measured title rasterizer and FFmpeg overlay path.
SRT/WebVTT serialization keeps exact cue times as a separate text export.

| Area                | Acceptance                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Persistence         | Cue/track IDs and versions validate; text/time edits retain IDs and increment manual revision; legacy projects remain valid.      |
| Transcript evidence | Current transcript revision, asset identity, segment timing and source range are bound; no word timing is fabricated.             |
| Edit                | Keyboard-accessible Composition lane and Inspector edit text, multiline layout, time, font and safe-area fields in three locales. |
| Safety              | Stale snapshots fail closed; clip/source locks continue to protect source edits; cue edits remain undoable and reopen safely.     |
| Output              | Actual FFmpeg MP4 is decoded before/during/after a Traditional Chinese cue; source hash remains unchanged; SRT/VTT times match.   |
| Manual gates        | Real voice quality, font design quality, 4K performance, physical displays and NLE playback remain separately unverified.         |

## M3 / F01 acceptance

| Capability                                      | Evidence                                                                                                                | Boundary                                                                            |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Strict declarative data and deterministic seeks | Core malformed/depth/array/animation cases and shuffled evaluated/PNG frames                                            | No project scripts, HTML, raw SVG, URLs or runtime expressions                      |
| Existing edit lifecycle                         | Solver/application history, unchanged rejection bytes, regeneration, autosave/reopen and browser authoring              | No second timeline or schema migration; protected clips/selections remain unchanged |
| Monitor / MP4 parity                            | One PNG producer; real 6-second 320×180/30fps MP4, 180 decoded frames, first/middle/last pixels and CJK/group positions | Playback is sampled; exact paused frames; no hardware/4K throughput claim           |
| Sources, limits and stale work                  | Private image snapshots, manifest/content hashes, final identity sweep, byte/pixel/frame budgets and abort/cache tests  | Local catalog PNG/JPEG/WebP only; failure withholds output                          |
| Visual QA / interchange                         | Typed nested image/text findings; complete JSON and OTIO source metadata; explicit FCPXML/EDL rejection                 | NLE graphic reconstruction and aesthetic placement require manual review            |

Exact gate outcomes, synthetic artifact hashes and remaining manual gates are in
[the M3 validation record](../validation-graphic-scene.md). M4/F02 Creative Story
Templates followed the M1 work; since then M2/F04, M3/F01, M4/F02 and M5/F03
have been integrated, and PR #31 implements M5/F08 on the merged Layer Editor.
This sequence does not silently add remote processing or automatic edits.

## M8B candidate — local motion review

M8B is separately stacked on M8A PR #35 exact head
`e78c4e06da2eb908dc0cb4548718c83b7798a8f1`. It adds real local external-video
candidates and deterministic camera fixtures to the existing Composition/Provider
boundaries, with explicit human review/Accept/Replace/Restore. It does not enable
remote image-to-video or claim that M6 tone/TTS performs video generation. See
[motion validation](../validation-motion-candidates.md) for exact evidence and
uncompleted CI/native/remote/manual gates. No independent mainline merge claim.

## M7E base and acceptance boundary

M7E uses main `bb2c4521ad894478893485119442a00ffd9b34cc` after M7A (#34).
M7B (#36), M7D (#37) and M8A (#35) remain independent candidates with unresolved
review findings. Runtime/process tests and installer workflow implementation do
not satisfy their feature gates or clean Windows/macOS installer acceptance.
