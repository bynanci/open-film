# Roadmap

OpenFilm's north star is ownership of media, story decisions, and the final edit.
The current release establishes a useful offline workflow; later milestones should
improve that workflow without tying the portable domain to a UI, cloud, or NLE.

Current priorities and evidence are tracked by [user pain point](docs/product-pain-points.md).
Shared geometry (PR #5) and workstation evidence/review recovery (PR #6) are merged
and **Automated Verified**; actual workstation behavior remains a separate gate.
The P0 cancellation slice is **Automated Verified**: the project releases before
a non-cooperating provider settles; final published-head checks are tracked in
PR #8. Ownership-aware recovery of transcription, waveform and scene analysis
is **Automated Verified** in the isolated PR #9 stacked on #8. Actual-child,
SQLite/HTTP/CLI and three-language browser regressions preserve live work,
manual corrections and successor results across confirmed recovery. Observers can
switch films while foreign analysis continues; local jobs and pending mutations
retain navigation barriers. Precision mutations and composition history also
block each other without changing normal Undo grouping. The corrected candidate has separate verification
from the earlier CI head. Selection controls also wait for saved acknowledgements
instead of silently dropping a second action. The current creative priority is
the bounded scene-script workflow below; merging development source is not a **Released** installer or
**Hardware Verified** recognition/NLE claim.

## Current — Reviewable scene-script suggestions

Extend saved Story narration and visual direction with optional LanguageProvider
suggestions, visible explanations and individual Accept/Skip decisions. Reuse the
configured provider and disclosed consent; bind evidence to the selected field's
actual source context. Durable receipts recover uncertain acceptance without
reapplying changes or overwriting newer text. Existing scene timing and
Compositions remain under the normal editing and solver workflow. See
[the contract](docs/scene-script-review.md),
[validation](docs/validation-scene-script-review.md) and
[acceptance tasks](TASKS.md#current--reviewable-scene-script-suggestions).

## Completed slice — Classified memories to scene scripts

Help people turn photos and saved categories into editable scenes, narration
drafts and visual direction, then compose within an explicit time limit. Library
tags and chronological grouping feed a bounded offline planner; proposed scenes
use existing Story beats and the duration solver. A user reviews the actual cut
before accepting a new Story/composition pair. Stale proposals and failed writes
must preserve existing films. See [the contract](docs/scene-script-planning.md)
and [acceptance tasks](TASKS.md#completed-slice--classified-memories-to-scene-scripts).

The [validation record](docs/validation-scene-script-planning.md) separates
targeted domain/application/browser success, the initial full-suite failures and
the corrected UI run. Published-head outcomes are recorded in
[PR #15 checks](https://github.com/bynanci/open-film/pull/15/checks); merge policy
requires complete green CI and fresh correctness review for that head. Its starting
main is `e2e926b23ac0fe3bb8aa1d474592a3aef80e6ae6`,
including merged PR #13; PR #14's fixture repair subsequently merged as
`61af41fbac17c32ffdc11679612636566bd73a1c`.
The [OpenCut reference](docs/opencut-reference.md) supplies scene-navigation,
command and preview/export principles; it does not establish a working
photo-to-screenplay capability to copy. Offline starters use declared categories
and chronology, with no image-understanding or generated-voice claim.

Optional LanguageProvider suggestions over declared scene text are the current
creative increment above. Motion/keyframes and visual analysis are separate
capabilities. Workstation first-open/one-hour memory data and real Resolve QA
remain independent manual gates; [issue #7](https://github.com/bynanci/open-film/issues/7)
stays open until actual evidence is collected.

## 0.1 — Local story and rough cut

Implemented: projects, SQLite catalogs, local folder import, metadata provenance,
derived media, duplicate/event analysis, ratings and selection state, generic
stories, an external template, duration-constrained composition, MP4 preview,
timeline export, CLI, local API, and desktop workspace. See [TASKS.md](TASKS.md)
for the detailed release checklist.

## Real editing — Working development tree

The Real Editing Workflow round has added a story-first graphical timeline,
non-destructive clip and beat commands, explicit locks, explainable duration
fitting, undo/redo and durable autosave with conflict recovery. Browser tests
exercise editing, preview rendering and reopening. Single/folder media relinking,
missing/offline state, portable cache references, Pixel/Insta360 source adapters
and safe supported HDR previews are implemented. The generated Proposal reference
workflow and independent OTIO/Resolve preparation make these capabilities testable.

## Global product experience — Working development tree

The editing foundation is merged in PR #1. The product round adds Welcome and
guided film creation, a nonblocking workflow indicator, goal-based import/export,
story boards with separate selected/suggested memories, contextual editing and
recoverable offline-media guidance. Stable workspace IDs, structured error codes
and Vue I18n support English, Traditional Chinese and Japanese without changing
user-authored film text. A separate persisted film locale controls template-owned
defaults; legacy text stays intact. Local theme/preferences, shared visual tokens,
CJK/pseudo layouts and browser accessibility checks support the desktop experience.
See [product workflow](docs/product-workflow.md), [i18n](docs/i18n.md) and
[design system](docs/design-system.md). Exact completed gates remain in TASKS and
the [validation record](docs/validation-global-product.md) and PR checks rather
than implying hardware or real NLE certification.

The Impeccable refinement keeps the same visual system while reducing chrome,
retaining preview visibility during story-rail editing and making editable exports
downloadable. The [portable Resolve QA flow](docs/resolve-workstation-qa.md) moves
the generated reference onto a real workstation via a CI artifact, with hash-checked
local paths and separate manual/API observations. Actual application verification
remains the next external gate; it is not replaced by helper tests.

## Next — Real-world verification and delivery

- Package the native shell with a verified local Node service and media runtime;
  test installation and updates on supported operating systems.
- Perform actual Resolve import QA first, including manual recreation of advanced
  edits currently stored only in OTIO metadata. Expand native effect support only
  with tested preservation; other NLEs follow later.
  The 2026-10-06 application preflight is blocked by the cloud environment's
  absent Resolve installation, GPU and desktop; the
  [Resolve record](docs/resolve-qa-record.md) remains not run pending access to a
  Resolve-capable workstation.
- Validate removable volumes on Windows hardware and representative Pixel HDR,
  Motion Photo and Insta360 source files.
- Record Resolve, ASR/LLM, GPU, camera, 4K, Windows installer and process-recovery
  evidence with the candidate-bound workstation QA contract. Unknown review owners
  now have a confirmed manual escape hatch; automatic Windows/macOS dead-owner
  proof still requires an OS-specific verified implementation.
  Initial review batches use the same exact execution checkpoint in a single
  transaction, preventing a recovered old process from publishing stranded work.
- Improve metadata corrections, timezone handling, sidecar ingestion, and event
  editing without hiding uncertainty.
- Validate real camera orientation/color behavior and future 360 reframing;
  source recognition alone is not stitching or optical validation.

## Then — Extensibility and scale

- Add a discoverable plugin/template registry with compatibility checks and
  documentation, plus additional device/source adapters.
- Add more general event/person coverage and media-balance constraints, together
  with explainable infeasibility reporting.
- Add further optional local vision, embedding, transcription and language providers;
  keep remote integrations explicit and consented.
- Benchmark 10,000–100,000-asset catalogs with published fixtures, memory/latency
  measurements, incremental analysis, background workers, and broader story
  scoping. No such scale claim is made by 0.1.0.

Professional color grading, complex GPU effects, cloud collaboration, marketplaces,
and mobile editing remain deferred. Milestones are priorities, not release dates.

## Performance and interaction refinement

Measure the existing workflow before adding complexity: defer unopened editor
work while preserving recovery, stabilize source-picker props, isolate Precision
transcript rendering, and keep keyboard focus visible on selected clips. Retain
60-item Library pagination, 100-segment Transcript pages, cached waveform paths
and existing job ownership. The [measurement record](docs/performance-interaction.md)
separates reduced work from unchanged costs and workstation-only performance.
The 500-clip Story rail now isolates clip presentation: selecting a clip updates
the old/new buttons while editor ownership and recovery stay in the parent.
Three comparable synthetic repetitions verify the bounded work reduction; the
measurement record discloses the added first-mount cost and memory limits.
Native-window and long-session performance still require workstation evidence.

## 0.3 — Media Intelligence & Precision Editing

P0 keeps Story-first editing and adds optional source intelligence: a local Whisper
provider through the existing transcription port, transcript/word persistence and
jobs, reusable waveform and scene analysis, generic markers, portable snapping
and Precision mode inside Edit. SQLite catalog v2 adds analysis tables without
replacing the project/composition engine. Source hashes, successful-only transcript
replacement and shared trim/split history protect existing stories and edits.

The foundation is independently adapted from [VidScribe concepts](docs/vidscribe-reference.md).
Models stay separately installed, GPU falls back to CPU, and transcription language
is independent of interface/film languages. CI fixture output validates protocols
and application behavior; real model accuracy/performance is a separate gate.
See [media intelligence](docs/media-intelligence.md) and [transcription setup](docs/transcription.md).

The foundation is merged as PR #3. Transcript productivity builds on it in 0.3.1
below. Geometry/safe frames, local face detection, highlights/derived compositions
and captions follow subsequent milestones. Real Resolve QA continues to require
a workstation; generated OTIO/parser checks do not replace it.

## 0.3.1 — Transcript Productivity & Reviewable Intelligence

This round builds a correctable text knowledge layer above the merged media
intelligence foundation: shared transcript commands and revisions, conservative
word-alignment state, separate durable undo/redo, search/replace, scoped terminology
and reviewable correction evidence. Offline glossary review is useful without an
AI provider; optional language review stays consented, bounded and human-approved.
The Story-first composition engine and main Library/Story/Edit/Export navigation
remain the same. See [transcript editing](docs/transcript-editing.md),
[glossary](docs/glossary.md) and [review suggestions](docs/review-suggestions.md).

Shared composition geometry follows in 0.3.2 below. Safe frames, local vision,
smart reframing, highlights/derived films and captions remain subsequent
milestones. They are not implemented in this round.

## 0.3.2 — Shared Geometry Contract & Preview/Renderer Parity

Use one composition-frame coordinate contract for source contain-fit, scale,
clockwise rotation and translation. Validate real FFmpeg pixels, transparent
rotation above lower tracks, sample aspect ratio, and browser layout lifecycle.
Preserve the Story-first editor and its existing trim, history and autosave.
See [geometry validation](docs/validation-geometry-parity.md). This milestone does
not certify actual Resolve/camera/color/installer behavior or build a live GPU
multitrack compositor. Workstation evidence and explicit safe review recovery
are merged in PR #6; actual workstation observations remain manual gates.
Further creative work is prioritized in the current scene-script slice above;
geometry itself does not implement script planning, motion or visual analysis.
Native first-open and long-session memory tooling is documented in
[the native performance procedure](docs/native-performance.md). It keeps
renderer intent timing separate from native IPC receipts, records platform
memory coverage, and preserves interruption evidence. Repeated workstation
first-open and one-hour series remain unverified until actually executed.
Fixture preflight binds project/database/media bytes, and verified per-run project
copies preserve identical initial films without rehashing edited templates.
Sampling races and evidence-volume failures retain explicit failure and owned
process cleanup. Final checkpoints are refreshed before classification, and a
surviving service fails finalization without force-killing active work. Automated
regressions also reject an unexpected service exit while awaiting normal native
shutdown. None of these satisfy the workstation gate.
An abnormal native exit during post-collection supervision also fails the final
report without replacing frozen collection clocks or skipping service cleanup.
Owned service cleanup uses a private acknowledged IPC protocol across platforms,
including Windows, and separately records selected-launcher and actual-service
Node identities. Process tests verify the protocol; Windows execution remains
unverified until workstation evidence is collected.
Fixture creation also falls back to exclusive copies on a per-source hard-link
ceiling (`EMLINK`). Linux fault injection verifies the complete 2,000-asset fixture
with 1,023 real links and 977 independent copies; actual NTFS behavior remains
unverified. Scoped terminal-output failures preserve failed report/lifecycle
evidence and graceful cleanup, including a native exit while a write is pending.
Automated visibility regressions preserve pending UI/Edit readiness through a
hidden interval, resume with two fresh visible frame opportunities and the original
clock origins, and cancel obsolete or unmounted views. Actual native presentation
and workstation timings still require manual evidence.
Compose-to-Edit visits use the guarded navigation path after the composition job
finishes, including the pre-render entry clock. Acknowledged creation remains
available if later project or asset-cache reads fail, preserving unrelated films
and visible errors without making cache recovery another creation action. Collection-stop events are
provisional; terminal events follow shutdown and final evidence persistence.
Manifest updates publish a complete sibling write by rename, preserving the last
valid manifest if replacement fails. These regressions do not replace Windows QA.
Readiness also rearms after transient startup state changes within the original
boot. Preflight verifies actual hard-link/copy topology rather than trusting
counts, and Linux memory sampling validates rooted membership after its reads.
Unknown identities or changed process trees cannot be credited as complete
evidence; these checks still require Windows/workstation validation.

## Monitor stability and frame transport

Edit now keeps visual clip positions aligned to integer output pixels and frame
ticks, streams render progress without reloading project data on every tick, and
exposes preview-only framing guides, source-frame stepping, clip looping and quick
transform controls. These remain on the existing composition and FFmpeg paths.
Automated FFmpeg and browser regressions are recorded in
[monitor validation](docs/validation-monitor-stability.md); physical display and
native resize behavior remain workstation checks.

## Composition-aware subtitle handoff

The first caption slice reuses corrected transcripts to preview and export
composition-bound SRT/WebVTT with immutable source/revision receipts. One selected
track, conservative segment boundaries, explicit warnings and stale checks keep
the workflow local and non-destructive. This does not add a caption track,
burn-in, karaoke or styling. See [the contract](docs/composition-captions.md) and
[the OpenCut gap matrix](docs/opencut-reference.md).

A future product flow is an explicit **derived composition / story variant**,
preserving the original and comparing selections, constraints and duration.
Recipes build on the existing headless CLI only when a repeatable workflow needs
them. A real extension must justify plugin lifecycle/permissions; MCP begins with
queries and revision-bound proposals. Keyframes and compositor work require a
specific editing limitation and shared preview/render semantics. None of these
broader platforms is implemented by subtitle export. Existing workstation gates
remain open independently of file-parser or browser success.
