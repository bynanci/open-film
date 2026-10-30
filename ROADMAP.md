## Professional Cut Desk — Phase 1A foundation

The accepted delivery goal is [v1.0.0](docs/roadmap/v1-readiness.md). That
crosswalk retains the existing D task owners and explicit native/manual gates;
the currently published stable remains v0.4.0.

Expert Source/Record now presents one saved Composition with rational/DF
timecode, continuous integer-frame Record transport, staged Source I/O and
acknowledged one-gesture transactions. General retains Story/Precision over the
same saved edits and session history. Original media remains immutable; markers
remain Source-only. See the [guide](docs/professional-cut-desk.md),
[approved phased design](docs/superpowers/specs/2026-10-26-professional-cut-desk-design.md)
and [validation evidence](docs/validation-professional-cut-desk.md).

The Phase 1A validation closes only its transport/transaction/timebase scope after
the recorded gates. A bounded Phase 1B context slice now provides the Edit
Decision Ribbon and transient film-look comparison; remaining Precision gestures,
dual-monitor/resizable completion, Phase 2 typed editing, Phase 3
tracks/proxies/audio and Phase 4 finishing remain incomplete. Chromium and
synthetic FFmpeg evidence do not close physical Windows/macOS,
high-DPI/color-managed display, hardware audio latency or long-form performance
gates. Unrelated roadmap work remains open.

D3A1 now projects the existing raw source peaks into saved Sequence time under
Expert Record, with bounded current-source reads, explicit preparation and
guarded seeking. Trim/speed/short-source behavior is verified against decoded
synthetic MP4 pulses; playback does not refetch peaks. This is read-only source
evidence before mixing. Independent review corrections are complete; exact
candidate/main gates are recorded on [PR72](https://github.com/bynanci/open-film/pull/72)
and must pass before merge. Rhythm analysis and J/L policy stay separate. See the [waveform guide](docs/sequence-waveforms.md)
and [validation](docs/validation-sequence-waveforms.md).

A bounded Phase 1B gesture slice now gives General-mode editors direct
clip-picture move and proportional corner resize in the existing Story monitor.
It uses the shared frame-pixel geometry and one acknowledged transform
transaction per completed gesture, with cancellation on stale owner, revision
or viewport changes. The reviewed old proportional-track preview and gesture
queue were not recovered because they diverge from current overlay ripple and
transaction recovery semantics. Expert Record now derives its decision Ribbon
from the same Composition resolver used by split and bypasses effective visual
looks only as a held or explicitly latched diagnostic preview. It does not save
or rebuild media, and stale context clears the bypass. Pointer-centred Precision
zoom/pan and the rest of Phase 1B remain incomplete. See the
[recovery review](docs/superpowers/reviews/2026-10-29-direct-manipulation-recovery.md)
and the gesture and contextual UI validation records:
[direct manipulation](docs/validation-direct-clip-manipulation.md) and
[Ribbon/compare](docs/validation-cut-desk-contextual-ui.md).

## Current implementation — Multi-source import and common analysis

OpenFilm is adding an additive source draft that can combine files, folders and
drops before any work begins. An immutable Expected Manifest records the user's
choice; a Verified Manifest binds successfully imported assets to exact content
and context revisions. Common analysis reads only that scope, so an existing
catalog item that reused import work is included while unrelated project media
is not. See the [accepted roadmap](docs/roadmap/multi-source-analysis.md).

M0 establishes catalog schema v6, a complete portability table policy, separate
batch/run/attempt state machines and safe schema-v5 Named Version upgrades. M1–M3
form the source-selection and common-analysis workflow. M4–M6 add versioned
time/GPX evidence, bounded representative-frame understanding and explicit
review/story adoption. Those product milestones are implemented in this branch.
M7 records actual platform evidence; local synthetic/browser/media gates are run
here, while native-shell, OS picker/permissions and external-drive workstation
checks remain open because this environment has no Rust toolchain or
Windows/macOS workstations.

M1 is now implemented: repeated file/folder/drop choices accumulate in one
project-owned revisioned draft; native drops reject symlinks without following
them; persistent browser handles remain in IndexedDB while ordinary `File`
objects expire to an explicit reselection state; and Standard/Expert modes are
presentations over the same commands. Existing one-root imports remain available
only after an explicit action. Review hardening fences delayed results, recovers
stale revisions and transactionally releases browser access that the authoritative
draft no longer retains. Ambiguous mutation responses reuse one idempotency
receipt before reconciliation. The final M1 interaction pass batches permission
lookups, pages large drafts at 100 source cards, turns typed drop failures into
actionable feedback, moves host-path entry behind Standard-mode progressive
disclosure, and preserves 44px coarse-pointer targets plus narrow-screen CJK
reflow. Independent review additionally closes portable v6 metadata leakage,
proves the 10,000-source storage boundary, bounds permission work, adds
project-indexed/retryable IndexedDB access and replaces the manufactured legacy
database with hash-pinned catalog and complete Named Version fixtures produced by
the actual schema-v5 application. Final remediation preserves typed portable
manifest/review semantics without admitting uncontracted evidence strings, makes
near-limit receipt pruning linear, compares SQLite structure as well as DDL, reads
only requested persistent handles and rejects identity ambiguity before a 33rd
same-name browser source can be duplicated.

M2–M6 now build on that draft without changing the timeline model. Discovery is
streaming and paged with symlink rejection and cancellation; sealing stages
browser bytes privately, verifies full SHA-256 identity and publishes immutable
Expected/Verified Manifests. Shared application services power Desktop, HTTP and
CLI scoped event/duplicate analysis with durable owner-fenced attempts and retry.
Versioned clock mappings and GPX route evidence preserve uncertainty and never
interpolate across segment gaps. Visual sampling extracts deterministic bounded
FFmpeg frames; remote vision sees only an explicitly consented sample and stores
hash receipts rather than media bytes. Search, preview and typed review decisions
are immutable and bound to result, operation, manifest and story fingerprints;
only explicit story adoption changes StoryGraph. See the [validation record](docs/validation-multi-source-analysis.md)
for exact gates and remaining workstation-only evidence.

The M6 interaction pass fences changed-input previews and racing searches,
retains exact acceptance receipts through lost responses/reopen, makes conflict
supersession explicit, reuses custom graph node IDs and refreshes acknowledged
adoption in the owning Storyboard. Independent review fixes and final local synthetic-media validation are complete;
4,397 Vitest and 284 Chromium regressions pass. Evidence and open workstation
gates are tracked in the same validation record.

Independent review additionally closes discovery-bound browser staging, portable
travel privacy, cancellation during long work, verified sampling bytes, final
publication/ownership fences and review-then-adopt semantics. Reviewed corrections,
merged groups and real source ranges remain deterministic projections over
immutable evidence; existing Composition timing is preserved.

## Evidence reconciliation and next stable series

The latest tagged release is `v0.4.0`; current `main` contains unreleased work and
the next stable version is not preassigned. The
[seven-subsystem reconciliation](docs/roadmap/seven-subsystem-reconciliation.md)
distinguishes merged evidence, partial behavior, true gaps and workstation gates.
It corrects current Catalog v6 and PR history, and prevents future work from
rebuilding existing HDR tone mapping, Source waveform, proxy generation,
CaptionTrack, fixed easing, focal contracts, Hero titles, Collect Media or
synthetic fixtures.

External research inputs are indexed in [research/](research/README.md). They are
non-authoritative hypotheses; reconcile feature status and proposed work against
this roadmap, [TASKS.md](TASKS.md) and the seven-subsystem evidence before adding
or changing roadmap items.

The delivery order preserves the accepted Multi-source M2 → M3 infrastructure
route, then reviews continuity/A-B-roll, rhythm and transcript transactions,
tactile photo/title/color increments, proxy/Collect lifecycle, reproducible
cross-platform rendering, native release closure and a local data-only preset
registry. Each is a separate reviewable PR with explicit acceptance and manual
gates only when implemented; the owner crosswalk does not create duplicate
checklists. None creates a second timeline or silently uploads media.

D5B now has a separately reviewable title-finishing candidate over the existing
measured raster: independent bilingual typography, bounded shadow/stroke/pills,
per-run font evidence and Collect bindings, and actual Story/Record caption
preview using the MP4 caption selection. Legacy pixels and canonical text/time
remain compatible. Focused synthetic MP4, SRT/VTT, recovery and UI evidence is in
[validation](docs/validation-title-finishing.md); six actual browser cases pass,
while independent review and exact-head integration remain pending. The existing nested F05 item is
still authoritative and no stable release is implied.

D6A managed preview storage (PR #64) implements a shared
Library/API/CLI queue, source/provenance fencing and reviewed cleanup. It reuses
the existing proxy generator and keeps output on originals. Independent review
corrections and 4464 local tests pass; exact Chromium/hosted merge gates are
tracked in [validation](docs/validation-proxy-storage.md). D6B trimmed
original/offline packages and physical installer gates remain separate.

D6B PR #65 now implements reviewed lossless range consolidation and explicitly
accepted offline delivery over the existing Collect owner. Bounded piecewise
source clocks, closed manifest v2, directory/ZIP relocation and decoded MP4/PCM
comparison protect every selected film; protected/unsupported clocks retain
originals. Default v1 remains compatible. Independent review fixes,4535 local
unit/integration and291 browser tests pass. Exact-head PR/push gates pass;
PR65 merged as5160d8f. Physical workstation evidence remains separate. See
[delivery validation](docs/validation-collect-coverage.md).

Windows workflow recovery for issues66–68 follows in PR69 on main after
D6B/CI integration: FFmpeg9 frame extraction, explicit Windows directory-sync capability for
scan/stage persistence, and acknowledged benchmark fixture shutdown. A pinned
Windows/FFmpeg9/font gate supplies narrow OS evidence; physical workstation and
installer obligations remain open. See
[issue validation](docs/validation-windows-issue-recovery.md).

CI follow-up separates fast pure contracts from heavy-by-default media/browser
QA, with exact discovery coverage and the historical aggregate check still
requiring both successful jobs. No media assertion or workstation gate is bypassed;
see [CI validation](docs/validation-ci-contract-media.md). PR70 merged as8de63ae
after full gates: fast1m45s; heavy45m35s/46m26s. This is separate feedback,
not a claimed overall speedup or release version.

CI reliability follow-up now fixes the actual main Pages dead links and adds
an obligatory PR website build. The complete browser suite moves to four isolated
single-worker VMs parallel with media, with exact discovery/candidate-bound
execution verification and every previous gate retained. PR synchronizations and
main pushes retain full coverage without duplicate feature push runs. Hosted
source gates pass:4591tests and291actual browsers. Observed E2E23m24s→11m18s,
Verify34m39s→12m55s; PR71 merged into PR69 before main so the known Pages fix
ships with Windows recovery. Final integration/main Verify and Pages outcomes
are recorded on PR69; see [validation](docs/validation-ci-pages-e2e.md).

The later documentation reorganization `71858cd` introduced three links outside
the website build root and two research-format failures. Its content and locales
are retained; repository-source links and focused regressions restore the same
strict website/format gates. Follow-up evidence is appended to that record.

## Released 0.4.0 source integration

Release `v0.4.0` retains project schema 1.0.0. This maintenance pass hardens
Named Versions and integrates independently
reviewed Photo Depth, Professional Export, Collect Media, Native Installer
candidate tooling, NLE Fidelity and Motion Candidates (PRs 35–40). Shared-source
contracts, non-destructive editing and explicit provider consent remain intact.
The final 16 feature/integration corrections include scene schema and seeking,
delivery and caption fences, passive NLE review, and atomic package/stem publication.
Final review also covers installed CLI metadata, empty ZIP/owned cancellation
cleanup and all 43 native FFmpeg filter capabilities. Combined basic gates and
actual cross-feature render/package parity pass; see
[release validation](docs/validation-stable-release.md). Final exact-head browser,
native CI, merge and tag results accompany the
[0.4.0 source release](https://github.com/bynanci/open-film/releases/tag/v0.4.0).

Supported FFmpeg 6.1.1 and 7.1.5 retain singleton and low-frame-rate picture
streams through delivery sampling; actual frame counts, picture holds and
first/last preview pixels are regression-tested without changing project rates.

Collect ZIP publication fences saved revisions/cancellation after archive creation
and publishes synchronously without replacing existing destinations.

Vite 8.2.4 addresses the Windows development-tool advisory
`GHSA-698v-4r3x-3vcv`; all 290 other package records and native lifecycle
policy remain unchanged. Full corrected-candidate gates precede merge/release.

CLI exports preserve saved revisions and unrelated jobs across durable retries.
Native installer distribution also requires compatible remediation and reachability
review for GLib 0.18.5 / `RUSTSEC-2024-0429`; that existing gate remains open.
Next are measured Windows/macOS/NLE workstation gates and larger caption-reference
batching. Native installers remain unverified/manual candidates.

## M6 Audio Quality and Provider Generation

PR 6A (#32) adds real-output MP4 loudness/peak measurement, sampled meters and reviewed
role normalization without replacing AudioAutomation. PR 6B follows as a separate
TTS generation PR with local mock, optional BYOK, explicit consent/cost and
preview/accept/import, managed-source history handoff and durable pending-edit
recovery. See [provider generation](docs/provider-generation.md) and its
[validation](docs/validation-provider-generation.md). Live paid TTS and hardware
listening remain manual gates. Existing local editing remains usable without a provider.
See [audio quality contract](docs/audio-quality.md) and [validation](docs/validation-audio-quality.md).
The earlier F05 photo-framing work remains deferred.

# Roadmap

OpenFilm's north star is ownership of media, story decisions, and the final edit.
The latest tagged release establishes a useful offline workflow; later milestones should
improve that workflow without tying the portable domain to a UI, cloud, or NLE.

## Integrated on main — Story Arc Authoring (PR #53)

The Quiet Studio redesign unifies carbon/pearl/blue surfaces, control and dialog
geometry, project/preferences/actions in the top bar, and the creative components.
Touch media controls remain discoverable; the export preview now accompanies its
settings on desktop. These are presentation changes over the same General/Expert
workspace, project and renderer contracts. See the
[design](docs/superpowers/specs/2026-10-24-quiet-studio-redesign-design.md) and
[validation](docs/validation-quiet-studio-redesign.md).

PR #53's final review pass also fences IME completion, localizes untouched arc
prompts, binds timing defaults to the selected arc, isolates Pipeline keyboard
focus and preserves the loopback image CORS boundary. The compact Export action
remains visible through 1024x768 expanded-locale layouts. Full local evidence is
3,821 Vitest tests and 228 Playwright tests from the merged head
`d19bf94ee0299005faa9e3e9e412cca61b965592`.

General and Expert operation modes share one editor and project contract.
Guided disclosure, compact expert spacing and searchable navigation commands
serve first-time and frequent creators; mode changes retain edits and history.
See [workspace modes](docs/workspace-modes.md) and its
[validation](docs/validation-workspace-modes.md).

The current interaction follow-up adds direct StoryGraph movement and typed
connections without introducing another story or timeline model. General mode
uses an explicit source/relation/target form; Expert mode adds pointer and keyboard
connection handles with a live path. Pipeline Workbench now advances through one
of five fixed review gates at a time, while Expert mode exposes the canonical
eight tasks, IDs, input dependencies and run diagnostics in a compact task rail.
The same application services own all saves and pipeline execution. See the
[design](docs/superpowers/specs/2026-10-24-story-connections-pipeline-flow-design.md)
and [validation](docs/validation-story-connections-pipeline-flow.md).

The earlier responsive surface pass established measured input boundaries,
responsive spacing, bounded inspectors and viewport-aware graph
controls. Theme-switch frame contrast and durable graph text/save/selection
recovery are covered by the same regression pass.
See [responsive surface validation](docs/validation-responsive-surfaces.md)
for reproduced breakpoint defects, retained regression checks and manual gates.

Expand the starting story structures and accept a user's own ordered beats,
then guide the author through the existing StoryGraph mind map, Pipeline
Workbench, and Compose/Edit flow. The Storyboard becomes a vertical reading
thread. M9 StoryGraph, M9 StoryPlan, M10 Pipeline, the existing Composition,
and project schema 1.0.0 remain the owners of their current contracts. See
[story arc authoring](docs/story-arc-authoring.md) and the
[validation record](docs/validation-story-arc-authoring.md) for the integration's
exact checks and outstanding gates.

The user-supplied cinema-foundation v1.1.0 and v1.0.0 archives now provide the
shot-proposal and emotional-overlay reference contracts. Their UI guidance is
applied in [workspace UX refinement](docs/workspace-ux-refinement.md), including
explicit media status and image/intent/timing hierarchy. Runtime shot-level
integration remains a separate follow-up requiring a reviewed scene/shot ID
adapter and revision-fenced sidecar storage. No improvised StoryPlan fields or
unimplemented shot-level behavior are claimed.

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

## Integrated recovery and delivery workflows

M6 Audio Quality and Provider Generation, M7A Named Versions and the reviewed
M7B–M8B feature heads share the existing application boundary. Named Versions
now includes explicit capacity management and stronger recovery/source fences.
The 0.4.0 integration below combines the six feature PRs; workstation and native
distribution gates remain independent of synthetic correctness tests.

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

The first historical caption slice reuses corrected transcripts to preview and export
composition-bound SRT/WebVTT with immutable source/revision receipts. One selected
track, conservative segment boundaries, explicit warnings and stale checks keep
the workflow local and non-destructive. That slice did not add a caption track,
burn-in, karaoke or styling. Native CaptionTrack and MP4 burn-in were integrated
later; SRT/VTT remains a separate derived export. See
[the contract](docs/composition-captions.md) and
[the OpenCut gap matrix](docs/opencut-reference.md).

Later work also added explicit derived composition/story variants that preserve
the original and compare selections, constraints and duration. Recipes build on
the existing headless CLI only when a repeatable workflow needs them. Executable
extensions still require a separate plugin lifecycle/permission threat model;
MCP begins with queries and revision-bound proposals. Further keyframes and
compositor work require a specific editing limitation and shared preview/render
semantics. Existing workstation gates remain open independently of file-parser
or browser success.

_Modified by OpenFilm contributors on 2026-10-18. Current OpenFilm first-party material is Apache-2.0; historical grants remain available. See LICENSE and NOTICE._

## 0.4.0 — Tagged creative-scene release

| Phase   | Included source behavior                                                                                              | Remaining boundary                                                                                                           |
| ------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| M7A #34 | Named snapshots, ordered/collision-free diff, explicit deletion and protected checkpoint/source verification          | Workstation permissions/recovery                                                                                             |
| M7B #36 | Profile previews, PNG, MP4 ratios, WAV and aligned role stems; review-bound crop and selected look/caption/quality    | Real-photo framing, sustained 4K and target-player QA                                                                        |
| M7C #39 | Native/metadata/baked/unsupported report, portable opaque precomps/full mix and receipts                              | Real NLE/Resolve import/relink; transparent overlays unsupported                                                             |
| M7D #37 | Referenced media/fonts, explicit rights, safe ZIP/directory and actual relocation/reopen render proof                 | Cross-machine filesystems, typography and license suitability                                                                |
| M7E #38 | Verified owned runtime lifecycle and manual installer-candidate tooling                                               | **Partial:** audited runtime inputs, Windows/macOS clean-machine signing/update/rollback evidence; no installer distribution |
| M8A #35 | Protected local photo layers, bounded deterministic parallax/fallback, alpha-safe masks and typed Visual QA           | Real subjects, edge aesthetics, display/HDR and 4K                                                                           |
| M8B #40 | Local fixture/external video comparison, explicit accept/replace/restore, protected history and bounded private cache | Remote motion disabled; provider/API/terms/cost/retention and human fidelity require separate review                         |

## Unreleased main after v0.4.0 — reviewed workflow integration

| Phase                             | Included source behavior                                                                                                                                                                                                                                                                                                                                                                             | Remaining boundary                                                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| M9A                               | Story Graph & Multi-Perspective Workspace (Outline, Graph, Storyboard); canonical Story/Beat integrity, 4 node types, 5 edge types with cycle rejection, revision-separated GraphViewState, quick actions, and synthetic benchmarks                                                                                                                                                                  | Touch/pen gestures and large high-DPI display workstation validation                                                   |
| M9B                               | Graph to Reviewable Storyboard Proposal (`StoryPlan`); 5 storyboard dimensions, deterministic input signature, echo clip solver support, source nature preservation, cycle/alternative conflict detection, ephemeral preview, and new rough cut adoption                                                                                                                                             | Live voice narration recording and multi-track audio listening QA                                                      |
| M10A                              | Guided Pipeline Orchestration; canonical 8-step recipe, typed ports and DAG acyclicity validation, immutable input snapshot digest, execution state vs. freshness separation, legal adoption receipts, concurrency = 1 serialization, tone mock rejection, zero-lock review gates, and reopen persistence                                                                                            | Hardware-accelerated multi-pass video export, listening QA, and high-DPI workstation verification                      |
| M10B                              | Pipeline Workbench UI/UX; docked bottom bar, expandable drawer, fullscreen modal, simplified 5-stage overview, 4-question stage cards, audio audition player, click-to-play video preview, cross-view navigation, outdated draft transparency, keyboard & IME protection, and responsive 3-pane layout                                                                                               | Touch/pen gesture workbench validation, high-DPI display QA, and live multi-track audio listening                      |
| M11A                              | Change Impact and Incremental Runs; composition revision vs. per-step consumed-input signature separation, 8-case impact matrix, verified artifact reuse with tampering detection, full-render fallback transparency, immutable run/receipt history, referenced asset pruning protection, and workbench UI                                                                                           | Real-photo multi-track listening QA and remote TTS latency verification                                                |
| M11B                              | Creative Variants and A/B Review; three-layer versioning separation (snapshot vs. session undo vs. variant), section isolation proof ("只改本段"), edit lock preservation, zero-render A/B comparison, single-audio playback safety, section-based timeline alignment, mandatory pre-adoption version checkpoints, post-restore run invalidation, shared media protection, and Collect Media privacy | Touch/pen gesture workbench validation, high-DPI display QA, and live multi-track audio listening QA                   |
| Story Graph × Pipeline Acceptance | Comprehensive end-to-end integration acceptance connecting M9A through M11B with fixed synthetic fixture (6 photos, 3 memories, 3 chats, route, WAV tone, TC subtitles; 30s/30fps -> 900 frames); 7 verified journeys, tamper-proof artifact reuse, fault injection resilience, A/B adoption/restoration, and Collect Media privacy                                                                  | Clean-machine physical GPU playback, live hardware audio listening QA, and workstation gates intentionally remain open |

See [release validation](docs/validation-stable-release.md) for exact inputs,
combined gate status and preserved original feature evidence. The `v0.4.0` tag
is the latest stable release; current `main` is the unreleased development base.
No separate timeline or project-schema migration is introduced.

## Next milestone — workstation evidence and delivery

Complete Windows/macOS clean-machine runtime/installer validation and audited
signing/update/rollback inputs before enabling distribution. Verify real NLE
import/relink/playback, representative fonts/licensing, protected subjects,
physical color, listening and sustained 4K performance. Future remote generation
must pass explicit provider consent, API/download safety and terms/cost/retention
review; local editing continues without a provider.

### 2026-10-30 M7E packaging evidence increment

Explicit tool support-file ownership, recursive ELF/PE/Mach-O import policies and
actual emitted JavaScript contribution inventories now extend the existing
runtime tooling. Full notice/source-obligation records and SPDX bind the runtime
payloads; final Rust/shell attribution stays outside the embedded manifest's hash
graph and awaits candidate binding. This is a bounded engineering increment,
not completion of M7E's audited per-platform inputs or installer gate. GLib,
complete native runtime/security builds, Windows/macOS trust/installation and
physical workstation checks remain open. See [validation](docs/validation-native-installer.md#2026-10-30-runtime-closure-and-emitted-attribution).
