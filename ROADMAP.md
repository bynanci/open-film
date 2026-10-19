## Active — M6 Audio Quality and Provider Generation

PR 6A adds real-output MP4 loudness/peak measurement, sampled meters and reviewed
role normalization without replacing AudioAutomation. PR 6B follows as a separate
TTS generation PR with local mock, optional BYOK, explicit consent/cost and
preview/accept/import. Existing local editing remains usable without a provider.
See [audio quality contract](docs/audio-quality.md) and [validation](docs/validation-audio-quality.md).
The earlier F05 photo-framing work remains deferred.

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
instead of silently dropping a second action. Existing film-look capabilities
remain part of the working tree. M3 is integrated; M4/F02 was merged as PR #29.
M5/F03 Layer Editor PR #30 is merged at main commit
`a33340c43d40f82825bc788e1c82625883e6acbb`; M5/F08 Reviewable Agent Editing is
implemented in PR #31 on that base. Its implementation-source CI and review
passed; the later documentation-only CI rerun is recorded in the validation
document.
Merging development source is not a **Released** installer or **Hardware Verified**
recognition/NLE claim.

## Implemented — M3 / F01 Declarative GraphicScene

Versioned Image, Text, Shape and Group data extends the existing Composition.
Explicit bounded enter/exit animation is deterministic under arbitrary seeks.
Monitor and FFmpeg share the same trusted PNG producer; project HTML/JS, remote
URLs and arbitrary image/font paths are rejected. Existing commands, history,
autosave and reopen own the edit lifecycle. JSON/OTIO retain the scene; unsupported
NLE formats fail explicitly. See [contract](docs/graphic-scenes.md),
[threat model](docs/security/graphic-scene-threat-model.md) and
[validation](docs/validation-graphic-scene.md).

## Implemented — M4 / F02 Creative Story Templates

Conversation Card, Route Story and Photo Relationship build on the same
GraphicScene v1 contract and saved Composition. Conversation text retains exact
original/citation and marked excerpts; GPX imports are selected locally,
bounded and data-only; photo roles retain asset and focus metadata. Gallery and
Inspector edits use the existing command history. See the
[template contract](docs/creative-story-templates.md) and
[validation record](docs/validation-creative-story-templates.md). M4 is merged
in PR #29 and is present in the M5 base; manual workstation and private-film
quality gates remain separate.

## Implemented — M5 / F03 Layer Editor (PR 5A)

Build direct GraphicScene object editing on the integrated M3/M4 contract. The
Monitor overlay selects, drags, resizes and rotates layers; the Inspector edits
opacity, z-order, visibility and locks. Grid/align snapping, guides and keyboard
nudging submit existing typed scene commands so revision checks, autosave,
Undo/Redo and reopen remain Composition-owned. See the [GraphicScene contract](docs/graphic-scenes.md),
[architecture](docs/architecture.md#declarative-graphicscene) and
[validation record](docs/validation-layer-editor.md). PR #30 merged this layer
editor on `main`; reviewable agent editing builds on its Inspector and typed
commands as a separate PR.

## Implemented — M5 / F08 Reviewable Agent Editing (PR #31 / PR 5B)

Layer-edit proposals use a bounded operation vocabulary and the selected
GraphicScene node as their only target. The Desktop shows the affected layer,
before/after values and conflicts; explicit acceptance submits one ordinary
`graphic.scene.upsert` command. Provider text generation is optional, uses the
existing `ProviderRegistry` and descriptor-bound text consent, and receives only
the selected node snapshot. Deterministic local commands work without a provider.
Stale revisions and locked or unselected content fail closed. Preview waits for
local autosave, uncertain acceptance blocks flush/navigation, selected actions
retain proposal order and show required prerequisites, template provenance is
validated before actions are exposed, and receipt persistence precedes the write
so reload restores the pending barrier. Keyboard history and direct direction
acceptance are also blocked while a receipt is unresolved. Provider work is
cancellable, bounded and outside the project mutation queue. See the
[validation record](docs/validation-agent-editing.md).

## Implemented — M2 / F04 Native Caption Track

Add versioned, stable-ID caption cues to the existing saved Composition, using
transcript segments only as provenance-backed timing evidence. Edit shares the
same composition timeline and command history for cue text, time, font and
safe-area changes. The renderer burns a selected track into MP4 through the
existing measured title path; SRT/WebVTT remain exportable with exact cue times.
See the [M1–M6 queue](TASKS.md#creative-scene-platform--m1m6-delivery-queue),
[capability/acceptance roadmap](docs/roadmap/creative-scene-platform.md) and
[native caption validation](docs/validation-native-caption-track.md). This
candidate does not claim word-level alignment or workstation/NLE verification.
Duration edits that would exclude a saved caption are rejected before autosave;
adjust the affected cue first so authored text and timing remain explicit.

## Queued — M6 and broader clip keyframes

The explicit M3/F01 scene scope replaces the earlier M3/F03 keyframe proposal;
general clip keyframes remain future work. M5 delivers the Layer Editor (F03)
and Reviewable Agent Editing (F08) as separately reviewed PRs; agent proposals
remain within ProviderRegistry/consent and require explicit acceptance. M6 extends photo,
sound and output verification with decoded audio evidence. The staged dependencies, risks
and acceptance evidence are recorded in the
[creative-scene platform roadmap](docs/roadmap/creative-scene-platform.md).

## Implemented — M1 / F07 Visual QA and contact sheets

Build a saved-revision review path on top of the current Composition, renderer,
SQLite jobs and Edit workspace. Desktop, HTTP and CLI share one application
service that produces a real MP4, timestamped decoded samples, typed measurable
issues and a private project-local report. Suspicious black/blank samples stay
manual-review findings so intentional cards and fades remain valid. Cancellation,
fresh retry, stale revisions, project switching and path-safe frame reads are
part of the contract; this does not create another timeline or project schema.
See the [F01–F13 gap crosswalk and staged PR route](docs/roadmap/creative-scene-platform.md)
and [validation record](docs/validation-visual-qa.md). Real-film aesthetics,
hardware performance and Resolve/NLE finishing remain manual gates.

## Current — Apache-2.0 distribution policy

The maintainer requested Apache-2.0 again for greater downstream freedom,
including commercial use and proprietary derivatives subject to its terms.
The restoration preserves earlier Apache/GPL grants and applicable attribution;
third-party components keep their own licenses. AGPL was considered but never
adopted. No media rights, runtime behavior or security checks change. See
[licensing](docs/licensing.md) and [ADR 010](docs/adr/010-apache-license-restoration.md).

## Current — Native text readability controls

The native-text follow-up exposes existing Regular/Bold typography and adds
clip-local end fades and a measured bottom safe distance through the current
presentation commands. Older defaults, Undo/Redo, locks and persistence remain
part of the contract. See [native text controls](docs/native-text-controls.md)
for verification and the separate SRT/WebVTT boundary.

## Current — MP4 output quality

Expose the saved output frame and original-source policy, then choose Standard
or High detail compression through a shared validated render option. Preserve
timing, geometry, source media and existing music. Actual encoder settings belong
in render evidence. This is a compression choice, not source-detail restoration,
photo-motion supersampling or a frame-size migration. See
[the contract](docs/export-quality.md) and [focused evidence](docs/validation-export-quality.md).
Combined browser/full regression and hardware gates remain distinct.

## Implemented — Original film looks

Six original, versioned creative looks support strength and saved whole-film,
scene and clip overrides. Shared commands preserve locks, Undo/Redo and recovery;
an explicit render-only option can unify one MP4 without changing the project.
Browser source preview and FFmpeg share coefficients with a documented
encoded-SDR RGB boundary, rather than claiming universal color parity. Private
render manifests retain recipe/source/build provenance. See
[the contract](docs/film-looks.md), [open-source reference decisions](docs/film-look-open-source-reference.md)
and [validation](docs/validation-film-looks.md).

Full color management, external LUT admission, physical film/camera simulation
and automatic grading remain later work. Real camera/HDR/display and Resolve
finishing remain workstation gates.

## Implemented slice — Reviewable scene directions to edits

Connect saved Story directions to supported photo presentation through an offline,
finite compiler. People review the exact source phrase, reason and before/after
value, preview temporarily, then explicitly adopt selected safe actions. Existing
commands own saving, Undo and rendering. Context bindings and durable request
receipts preserve manual work through stale reviews, lost responses and reopening.
The first vocabulary covers contain/hero and hold/gentle push-in/horizontal pan;
unknown prose is shown rather than guessed. Film timing stays unchanged and the
configured maximum remains enforced. See [the contract](docs/scene-direction-editing.md),
[validation](docs/validation-scene-direction-editing.md) and
[acceptance tasks](TASKS.md#implemented-slice--reviewable-scene-directions-to-edits).

Source-range/rhythm and duration changes require a later, separately reviewed
slice. Arbitrary prose/image understanding, generated voice and automatic grading
remain deferred. Real Windows/camera/Resolve and private-film quality gates continue.

## Implemented slice — Photo-film quality

Turn manual design decisions into actual output using the existing composition,
commands and renderer: protected focal layouts, diptychs, bounded still motion,
measured CJK title roles and non-rippling imported music/narration overlays.
Local font measurement/rasterization runs in the Node service, while the Desktop
uses the resulting PNG without importing the native font/raster runtime.
Per-render private recipes record source identities, font hashes, timing,
encoding and explicit fallback warnings.

A public generated 20-second A/B fixture has produced two real MP4s with equal
duration, sampled frame comparisons and measured fades/ducking. The evidence
does not establish private-film improvement, real narration quality or projector
readability. Corrected implementation `8baa274` passes local non-browser gates,
including 158 files / 2,273 tests, and 11/11 focused photo browser checks. It has
a fresh clean-tree A/B render with unchanged output hashes. Independent
follow-up review covers twelve corrected P2 issues, including recoverable
historical typography and preserved visual-overlay/source-replacement edits.
Its full browser/CI outcomes are tracked on
[PR #18 checks](https://github.com/bynanci/open-film/pull/18/checks). The initial
`ae61376` browser run and Python-environment retry, and the preceding `025bead`
119/119 browser run, remain historical evidence; they do not validate the newer
expanded full suite. See [the contract](docs/photo-film-quality.md),
[validation](docs/validation-photo-film-quality.md) and
[acceptance tasks](TASKS.md#implemented-slice--photo-film-quality).

The scene-direction slice above binds reviewed phrases to these supported
primitives. Later increments can improve source-range/rhythm choices. Semantic image
understanding, grading, generated narration and automatic audio analysis remain
later work. Audio automation currently stays clip-local when trimming or changing
source-in; splitting configured envelopes requires explicit removal and manual
reconfiguration. Real source listening, projection, Windows/camera and Resolve
gates continue independently.

## Implemented slice — Reviewable scene-script suggestions

Extend saved Story narration and visual direction with optional LanguageProvider
suggestions, visible explanations and individual Accept/Skip decisions. Reuse the
configured provider and disclosed consent; bind evidence to the selected field's
actual source context. Durable receipts recover uncertain acceptance without
reapplying changes or overwriting newer text. Existing scene timing and
Compositions remain under the normal editing and solver workflow. See
[the contract](docs/scene-script-review.md),
[validation](docs/validation-scene-script-review.md) and
[acceptance tasks](TASKS.md#implemented-slice--reviewable-scene-script-suggestions).

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

Optional LanguageProvider suggestions over declared scene text are implemented
above. The current photo-film slice adds manual structured layouts and bounded
still motion; visual analysis remains a separate capability. Workstation first-open/one-hour memory data and real Resolve QA
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
queries and revision-bound proposals. Further keyframes and compositor work require a
specific editing limitation and shared preview/render semantics. None of these
broader platforms is implemented by subtitle export. Existing workstation gates
remain open independently of file-parser or browser success.

_Modified by OpenFilm contributors on 2026-10-18. Current OpenFilm first-party material is Apache-2.0; historical grants remain available. See LICENSE and NOTICE._
