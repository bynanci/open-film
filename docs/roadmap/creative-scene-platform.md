# Creative Scene Platform

This roadmap adapts the product goals to the current `main` source tree. The
checked-in `TASKS.md`, `ROADMAP.md`, README and architecture documents do not
define an F01–F13 catalogue; the crosswalk below is a new planning aid, not a
claim that these labels were previously accepted or completed. Status describes
the behavior present in `main` at base `089eaf20541391d59c81da075d739bcd3844ceb4`.

## Capability gap crosswalk

| ID  | Capability                                                        | Main status                     | Evidence and gap                                                                                                                                                                                                                                |
| --- | ----------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01 | Local-first projects, source references, hashes and derived media | Complete foundation             | `docs/architecture.md`, `docs/CONTRACTS.md`, source hashing, project cache and relink contracts are implemented.                                                                                                                                |
| F02 | Story-first scenes and saved Composition editing                  | Complete foundation             | Story/solver/Composition workflow, saved timeline commands, locks, Undo/Redo and reopen are in `packages/application`, `packages/solver` and Edit.                                                                                              |
| F03 | Dynamic scene motion and reusable timing                          | Partial                         | Photo motion supports bounded hold, push-in, pan and pull-out; a general multi-property keyframe editor is absent (`docs/scene-direction-editing.md`, `docs/photo-film-quality.md`).                                                            |
| F04 | Native caption track and transcript provenance                    | Missing on main; M2 in progress | Main has transcript-mapped SRT/WebVTT export and measured title rendering, but no saved Composition caption cues or MP4 caption burn-in. M2 adds stable versioned cues, Edit controls, transcript provenance and shared render/export behavior. |
| F05 | Photo narrative and measured title workflows                      | Partial                         | Manual focal/protected framing, diptychs, scene direction and measured graphic titles exist; semantic image interpretation and automatic narrative selection are deferred.                                                                      |
| F06 | Music, narration and sound design                                 | Partial                         | Overlay music/narration, fades, gain and manual ducking render; automatic mix analysis and production audio review remain open.                                                                                                                 |
| F07 | Saved-revision Visual QA and timestamped contact sheets           | Missing as a product workflow   | Quality scripts already render synthetic MP4s and contact sheets (`docs/validation-photo-film-quality.md`), but Desktop/API/CLI cannot request a shared QA report or jump from an issue to Edit time. This is the M1 scope.                     |
| F08 | AI-assisted creative edits                                        | Partial                         | Local speech recognition and optional text suggestions / bounded scene-direction commands exist; visual understanding and generated imagery are not implemented.                                                                                |
| F09 | Non-destructive edit safety and recovery                          | Complete foundation             | Source-preserving edits, locks, serialized save contracts, autosave, bounded history, cancellation and reopen coverage are present.                                                                                                             |
| F10 | FFmpeg output and verifiable provenance                           | Partial                         | Real MP4 rendering, source/font hashes, warnings, FFprobe and interchange evidence exist; no product-level sampled-frame report currently binds those checks to a saved revision.                                                               |
| F11 | Shared application logic across entry points                      | Complete foundation             | Desktop and CLI use `@openfilm/application`; loopback HTTP adapts the same services. New QA behavior must remain behind that boundary.                                                                                                          |
| F12 | Privacy, security, licensing and accessible localized UX          | Partial                         | Apache-2.0/NOTICE, local-only sources, API guards, project-local caches, three locales and keyboard-tested Edit controls exist. QA images and reports still need explicit cache isolation, path-safe serving and localized keyboard navigation. |
| F13 | Reproducible validation and real-world release evidence           | Partial                         | Synthetic media, actual FFmpeg regressions and manual Resolve/workstation gates are documented. Hardware, private-film quality, camera, 4K and NLE sign-off cannot be inferred from fixture success.                                            |

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
                  ├── M2 / F04  native caption track and subtitle finishing (this branch)
                  ├── M3 / F03  richer clip-local motion/keyframe authoring
                  ├── M4 / F05,F08  photo narrative and consented AI assistance
                  └── M5 / F06,F10,F13  audio/output review and workstation gates
```

| PR  | Milestone                                 | Scope and dependency                                                                                                                                                                                                    | Exit evidence                                                                                                                                                                                                         |
| --- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | M1 / F07 Visual QA                        | Existing candidate branch `codex/m1-f07-visual-qa`. Reuse saved Composition, `TimelineEditor` revision logic, `FFmpegRenderer`, project jobs and existing Edit monitor. Do not change project schema or add a timeline. | Synthetic-source real MP4; decoded timestamped frames; source/output hashes; typed missing/font/overflow/black-review issues; API/CLI/Desktop parity; stale, cancel/retry, project-isolation and keyboard/i18n tests. |
| 2   | M2 / F04 Native Caption Track             | Current implementation. Extend the saved Composition contract and existing editor/renderer/transcript mapper; do not add a second timeline or infer word alignment.                                                     | Synthetic narration MP4 with decoded CJK timing/placement, exact SRT/VTT times, transcript/manual revision, stale and source-lock/history/reopen coverage.                                                            |
| 3   | M3 / F03 Motion authoring                 | Build on existing clip-local motion commands; define bounded keyframe semantics and arbitrary-seek preview/render parity before extending the saved contract.                                                           | Deterministic arbitrary-seek output, lock/history/reopen tests and explicit interchange limitations.                                                                                                                  |
| 4   | M4 / F05 + F08 Photo story assistance     | Depends on explicit consent/data boundaries and the existing scene-direction review service; image understanding remains opt-in and local/remote providers are disclosed.                                               | Synthetic/CC0-only fixtures, source-bound recommendations, review/accept/reject history and no automatic edit without approval.                                                                                       |
| 5   | M5 / F06 + F10 + F13 Audio and release QA | Depends on M1 report/provenance model; extend audio diagnostics and publish workstation requirements separately.                                                                                                        | Actual decoded audio metrics, repeatable manifests, and separately recorded hardware/Resolve/4K manual gates.                                                                                                         |

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
