# Seven-subsystem evidence reconciliation

Audit date: 2026-10-29. Evidence base: merged `main`
`0ef8733ed6825622709ca5eba57adc56184a4521`, including contextual Cut Desk
[PR #60](https://github.com/bynanci/open-film/pull/60) at exact feature head
`26c38ac8db1282b183390bdb2e5848d16979445b`.

This document reconciles the proposed cinematic roadmap with the code that
actually exists. It is not a promise to ship four releases at once. The latest
tagged release is `v0.4.0`; current `main` contains unreleased work and the next
stable version remains a release decision after correctness and workstation
gates. Project schema remains `1.0.0`; the current SQLite catalog is **v6**.

## Status rules

- **Implemented / evidence** means the capability is merged on the pinned base,
  has a reachable contract or entry point, and has a regression or validation
  record. A checked task by itself is not evidence.
- **Partial** means a usable subset exists. Only the missing acceptance behavior
  is queued; the existing subsystem is not rebuilt.
- **Missing** means no current contract, entry point and regression implement the
  behavior. The closest reusable owner is named before implementation begins.
- **Manual gate** means code exists but physical hardware, NLE, display, signing,
  long-form or human-quality evidence is still absent. A manual gate is not
  closed by adding another mock.
- **Candidate** is separate metadata. A branch or PR never counts as implemented
  evidence until it is merged and its exact-head checks are complete.

## Historical and release corrections

- PRs #1–#6 are merged foundations; PR #7 does not exist; #8–#22 are merged;
  #23 was closed without merge; #24–#25 are merged. Native caption/render work
  associated with the closed #23 continued in later merged work.
- Catalog v5 arrived with #16. Current Catalog v6 arrived with #56, so v5 is now
  a migration and Named Version compatibility fixture, not the live schema.
- Scene direction review, monitor stabilization and photo movement were developed
  across #17–#24. Professional Cut Desk begins at #57; direct clip manipulation
  is #59 and contextual Ribbon/compare is #60. These are not capabilities of the
  earlier #16–#25 range.
- Apache-2.0 restoration in #25 remains the current first-party license; `NOTICE`
  and historical grants remain authoritative.
- `v0.4.0` is already released. `main` is an unreleased development line, so the
  next stable version is deliberately **TBD**, not assumed to be `0.5.0` or
  `1.0.0`.

## Capability evidence matrix

Status is assigned per capability, not per broad subsystem. Manual evidence is
kept in its own column so an automated implementation cannot hide an open
workstation or editorial gate.

| Capability                                                                                                | Status                       | Contract, regression and validation evidence                                                                                                                                                                          | Manual gate                                | Remaining scope                                                                                                                       |
| --------------------------------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| StoryPlan, multi-visual scenes and reviewable Scene Direction                                             | Implemented / evidence       | `packages/core/src/story-plan.ts`; `packages/application/tests/story-plan.test.ts`; `packages/application/tests/scene-direction.test.ts`; `docs/validation-scene-direction-editing.md`                                | Real editorial pacing                      | None in D0                                                                                                                            |
| Pipeline artifact reuse by consumed-input signature                                                       | Implemented / evidence       | `packages/application/src/pipeline-orchestrator.ts`; `packages/application/tests/pipeline-change-impact.test.ts`; `packages/application/tests/pipeline.test.ts`; `docs/validation-story-graph-pipeline-acceptance.md` | Long-form project profiling                | This is artifact reuse, not node-local graph solving                                                                                  |
| Adjacent-shot continuity report                                                                           | Missing                      | No typed shot-scale, eyeline or screen-direction evidence exists in `StoryPlanScene` or `Clip`                                                                                                                        | Human continuity judgment                  | Deterministic motion/duration/density diagnostics; shot-scale/eyeline must be `manual-review` until versioned evidence exists         |
| A/B-roll coverage and J/L-cut semantics                                                                   | Implemented / evidence       | `packages/core/src/coverage.ts`; `packages/core/tests/coverage.test.ts`; `packages/solver/tests/coverage-editing.test.ts`; `docs/validation-audio-policy.md`                                                          | Documentary pacing/listening               | Revision-bound coverage plus default `keep-primary` and explicit `mix-secondary \| replace-primary` role/gain policy                  |
| Crossfade transition contract and actual render                                                           | Implemented / evidence       | `packages/core/src/models.ts`; `packages/solver/tests/editing.test.ts`; `packages/render/tests/render.test.ts`                                                                                                        | Editorial transition taste                 | Existing `crossfade` must be reused, not rebuilt                                                                                      |
| Emotion-curve guidance, adjacent-scene micro-preview and Dip-to-Black/White                               | Missing                      | Reuse Story/Scene Direction review and the existing transition owner                                                                                                                                                  | Human pacing and transition review         | A derived non-authoritative curve, bounded previous-2s/current-3s preview and shared Monitor/FFmpeg dip contract                      |
| Photo focal/protected layout, diptych and deterministic motion                                            | Implemented / evidence       | `packages/core/src/presentation.ts`; `packages/core/tests/presentation.test.ts`; `packages/render/tests/presentation-capability.test.ts`; `docs/validation-photo-film-quality.md`                                     | Real faces, edge quality, 4K display       | Fixed easing and floating-point cubic render already exist                                                                            |
| Direct focal gizmo, custom bounded Bézier and ambient fill                                                | Missing                      | Reuse the existing presentation evaluator and command owner                                                                                                                                                           | Touch/pen and real portrait review         | Preview gesture, versioned bounded curve and shared preview/render fill plan                                                          |
| Source waveform, generic snap primitive with beat-marker priority, duck controls and output audio metrics | Implemented / evidence       | `packages/media/src/intelligence.ts`; `packages/analysis/tests/snapping.test.ts`; `packages/render/tests/audio-quality.test.ts`; `docs/validation-audio-quality.md`                                                   | Physical listening                         | Source view and manual automation exist; there is no onset/beat producer, Sequence waveform or sidechain detector                     |
| Sequence waveform, onset/beat/phrase evidence and envelope UX                                             | Missing                      | Reuse `resolveClipSourceRange` and `resolveClipFrameRange` in `packages/core/src/sequence.ts` with current source-clock peaks                                                                                         | Real music/downbeat quality                | Trim/speed/frame-safe projection, source-hash fencing, end-to-end beat markers/snap, visible envelope and optional threshold contract |
| Native captions, burn-in, SRT/VTT and measured title raster                                               | Implemented / evidence       | `packages/core/tests/native-captions.test.ts`; `packages/render/tests/native-captions.test.ts`; `packages/core/tests/title-layout.test.ts`; `docs/validation-native-caption-track.md`                                 | Representative font licensing/rendering    | None in D0                                                                                                                            |
| Transcript-driven ripple edit                                                                             | Implemented / evidence       | `packages/core/src/transcript-ripple.ts`; `packages/core/tests/transcript-ripple.test.ts`; `packages/application/tests/transcript-ripple-editor.test.ts`; `docs/validation-transcript-ripple.md`                      | Ambiguous speech judgment                  | Reliable timings only, application-level compound operation and explicit caption/graphic/audio retime policy                          |
| Independently styled bilingual runs and cinematic shadow/stroke/pills                                     | Candidate / evidence         | Extend `packages/core/src/title-layout.ts` and its shared raster                                                                                                                                                      | Typography review                          | Versioned bounded styling and missing-font evidence                                                                                   |
| HLG/PQ detection and bt709 tone mapping before Film Looks                                                 | Implemented / evidence       | `packages/media/src/color.ts`; `packages/media/tests/color.test.ts`; `packages/render/tests/film-looks.test.ts`; `docs/validation-film-looks.md`                                                                      | Calibrated HDR/SDR displays                | Dolby metadata is detected; unsupported or incomplete profiles fail closed                                                            |
| Primary correction and reviewable Auto Match                                                              | Missing                      | Reuse the tone-map → Film Look order                                                                                                                                                                                  | Physical color judgment                    | Versioned temperature/exposure/contrast; measured before/after proposal, never silent source mutation                                 |
| Catalog v6 and immutable Named Version compatibility                                                      | Implemented / evidence       | `packages/catalog/tests/catalog.test.ts`; `packages/catalog/tests/project-snapshot.test.ts`; `packages/application/tests/project-versions.test.ts`; `docs/CONTRACTS.md`                                               | Filesystem permissions/recovery            | Historical v5 inspect/diff do not rewrite; asset-aware restore upgrades a private copy                                                |
| Import proxies and portable preview cache                                                                 | Implemented / evidence       | `packages/application/src/index.ts`; `packages/application/tests/application.test.ts`; `packages/application/tests/portable-cache.test.ts`                                                                            | Sustained large-project profiling          | Existing proxies are per-asset, source-hash-keyed project-relative derivatives                                                        |
| Proxy queue/quota/eviction/rebuild lifecycle                                                              | Missing                      | Reuse the current proxy generator and cache paths                                                                                                                                                                     | Disk-pressure behavior                     | Cancel/resume, stale-hash fencing, health and deterministic recovery                                                                  |
| Full-original Collect Media directory/ZIP and relocation                                                  | Implemented / evidence       | `packages/application/tests/collect-media.test.ts`; `packages/application/tests/collect-media-source-safety.test.ts`; `docs/validation-collect-media.md`                                                              | Cross-filesystem and large external drives | Current streaming stored ZIP remains subject to ZIP32 limits                                                                          |
| Trimmed-original and offline proxy-only Collect modes                                                     | Missing                      | Reuse the Collect planner/verifier                                                                                                                                                                                    | Finishing handoff quality                  | Handle/source-offset receipts plus decoded picture/audio/time parity to the original baseline                                         |
| Synthetic render fixtures and Linux verification                                                          | Implemented / evidence       | `packages/render/tests/render.test.ts`; `packages/render/tests/timing.test.ts`; `packages/render/tests/film-looks.test.ts`; `.github/workflows/ci.yml`                                                                | Windows/macOS raster/codec variance        | Existing synthetic coverage is not a pinned cross-platform render environment                                                         |
| Fixed test font/toolchain, metric policy and focused OS matrix                                            | Missing                      | Extend Verify without weakening structural assertions                                                                                                                                                                 | Focused Windows/macOS runners              | Exact provenance/structure, recorded encoded SHA and narrow decoded metrics                                                           |
| Native runtime contract/stager                                                                            | Implemented / evidence       | `tests/integration/native-runtime.test.ts`; `tests/unit/runtime-manifest.test.ts`; `docs/native-installer.md`; `docs/validation-native-installer.md`                                                                  | Audited target artifact absent             | Tooling requires Node, FFmpeg/FFprobe, CJK font, SBOM and licenses; no distributable target has been dispatched                       |
| Signed native distribution/update/rollback closure                                                        | Missing                      | `.github/workflows/native-installer.yml` is manual and input-gated                                                                                                                                                    | Signing, notarization, clean machines      | Compatible GLib remediation **and** reachability review/re-audit, audited runtime input and workstation evidence                      |
| Plugin Manifest v1 and declarative GraphicScene validation                                                | Implemented / evidence       | `packages/plugin-sdk/src/manifest.ts`; `packages/plugin-sdk/tests/manifest.test.ts`; `packages/core/src/graphic-scenes.ts`; `packages/core/tests/graphic-scenes-schema.test.ts`; `docs/adr/004-plugin-system.md`      | Extension governance                       | Executable plugins are trusted code; discovery/loading remains deferred                                                               |
| Data-only Film Look/Story/Title preset registry                                                           | Candidate / focused evidence | `packages/core/src/presets.ts`; application registry/editor/StoryPlan owners; `docs/validation-local-presets.md`                                                                                                      | Independent review and full integration    | Local bounded single JSON; explicit declared-license acceptance; portable snapshots; no executable loading                            |

### What must not be rebuilt

- Story scenes already support several visual assets. The missing behavior is
  overlapping A-roll/B-roll coverage, not another Story or Timeline model.
- Focal-point data, protected regions, diptych, fixed ease-in-out and sub-pixel
  FFmpeg motion already exist. The missing work is tactile control and additional
  bounded presentation modes.
- A waveform already exists in Precision Source, and duck attack/release already
  exist. The missing work is sequence projection, analysis and envelope UX.
- Hero titles, tracking, scrims, native captions and HDR-to-SDR tone mapping are
  implemented. New work must extend those contracts rather than replace them.
- Crossfade already has a typed edit and actual FFmpeg regression. Scene review
  work may add micro-preview and dip transitions, but must not rebuild crossfade.
- Proxies, Collect Media, synthetic fixtures and a plugin manifest schema exist.
  Their lifecycle, reproducibility and safe data-only extension points are the
  gaps.

## Evidence anchors by subsystem

### Story and continuity

`packages/core/src/story-plan.ts`, `packages/story/src/story-planner.ts` and
`packages/solver/src/index.ts` own the proposal-to-Composition flow. Pipeline
incrementality in `packages/application/src/pipeline-orchestrator.ts` reuses
artifacts by consumed-input signature; it is not node-local StoryGraph solving.
`SceneDirectionReview.vue` already supports Preview, Select, Skip and Accept.

The next contract should be a derived `ContinuityReport` over the saved
Composition. Current typed evidence can deterministically measure adjacent
motion, duration and visual density. Shot scale, eyeline and screen direction do
not yet have a trustworthy typed source, so they must produce `manual-review`,
never warning/pass, unless a future versioned evidence contract is present. The
local analyzer must not call a provider; future visual analysis would require
ProviderRegistry, explicit consent and stale/source-hash fencing. Accepted
changes continue through existing typed commands.

A-roll/B-roll coverage also needs a revision-bound typed visual-overlay/coverage
operation in the same Composition and an explicit embedded-audio policy. The
default `keep-primary` mode excludes B-roll embedded audio and continues the
primary narration. `mix-secondary` preserves primary audio and adds the B-roll
stream with an explicit role and bounded gain; `replace-primary` suppresses the
primary stream only for the accepted range and uses the B-roll role/gain. The
D3B1 owns only the versioned audio-policy primitive/evaluator and deterministic
mix plan. D3B2 persists the accepted coverage relationship with that mode, role,
gain, source hashes and revision for Undo/reopen; it must not secretly
materialize a second audio clip. The current `audio.add` command rejects video
sources, while a visual B-roll clip can otherwise add its embedded audio to the
render. Both need their own compatibility design. They may be designed in
parallel, but D3B2 product implementation depends on D3B1. Actual MP4 evidence
must prove continuous narration where selected and no double mix. No mode may
create a second timeline.

Crossfade is already a typed transition with actual render coverage. The missing
Scene Direction slice is a bounded adjacent-scene micro-preview, a clearly
advisory emotion curve and Dip-to-Black/White parity. The preview must be derived
from the saved Composition and must not become another edit state.

### Photo presentation

D5A candidate update (2026-10-30): the existing F05 owner now has an isolated
implementation of direct focal interaction, strict separately versioned bounded
custom easing and raw ambient-fill Monitor/FFmpeg parity. See the
[contract](../photo-film-quality.md#photo-finishing-d5a-candidate),
design in `docs/superpowers/specs/2026-10-30-d5a-photo-finishing-design.md` and
[candidate validation](../validation-photo-film-quality.md#d5a-photo-finishing-candidate).
The audit-base matrix remains historical; this candidate still requires fresh
whole-branch review and the complete exact-head gate before merge. Primary color
remains D5C's independent owner.

`packages/core/src/models.ts` and `presentation.ts` already own normalized focal
and protected regions. `PhotoPresentationPreview.vue` and the renderer share the
same evaluator; `packages/render/src/photo-filters.ts` uses per-frame floating
point perspective and cubic interpolation.

The focal gizmo therefore writes the existing `PhotoLayout.focalPoint` through
the existing presentation command, with transient drag preview and one accepted
history step. Ambient fill needs a versioned PhotoLayout option and a shared
preview/render plan. Custom Bézier requires a bounded, validated motion version;
unbounded expressions or project JavaScript remain forbidden.

### Rhythm and sound

`packages/media/src/intelligence.ts` extracts bounded PCM peaks with source-hash
provenance. `PrecisionEditor.vue` renders Source waveform data;
`packages/analysis/src/snapping.ts` already prioritizes typed beat markers.
`SoundtrackPanel.vue`, core presentation and FFmpeg audio filters share manual
duck regions. Audio Quality already measures real rendered MP4 audio.

A sequence waveform adapter should project the existing source-clock peaks by
reusing both `resolveClipSourceRange` for source in/out/speed and
`resolveClipFrameRange` for timeline start, duration and rational frame
boundaries, including duration/source clamps. It must not invent a second clock
conversion. Onset/beat analysis writes versioned, source-hash-bound evidence; a
solver may propose a cut within a declared window (for example ±150 ms), but only
explicit Accept changes the Composition. A first envelope UI should visualize
the current automation before introducing a v2 sidechain threshold contract.

### Transcript and titles

Transcript delete currently changes transcript evidence only. Text-based cutting
must first map a reliable transcript interval to clip/source ranges, then show a
Preview → Select → Accept proposal. Estimated or manually text-edited timing may
not auto-cut. Current split/ripple commands cannot safely cover every case:
automation can block split, overlay clips do not ripple, and captions/graphics
can conflict with the shortened range. D4 therefore needs one application-level
compound operation with explicit caption, GraphicScene, overlay-audio and duck
envelope retime/conflict policies. Unsupported cases fail closed; a successful
acceptance creates one history step and an explicit recovery receipt.

Bilingual titles should extend the existing measured raster with versioned
primary/secondary runs, independent font metrics and missing-font evidence.
Shadow, stroke and per-line pills remain declarative bounded data and must use
the same raster for browser and FFmpeg.

D5B's approved candidate now implements this contract with canonical text plus
versioned LF-boundary metadata and a separately versioned finishing object.
Actual run font/face/hash bindings follow render review and Collect; missing
glyphs and stale owners fail closed. Story/Record caption preview uses the
existing output selector and measured PNG. Focused synthetic MP4/SRT/VTT proof
and six actual browser cases pass; independent review and exact-head integration
remain pending. See [validation](../validation-title-finishing.md).

### Color

`packages/media/src/color.ts` already identifies HLG/PQ and generates the
supported bt709 tone-map chain. Render applies tone mapping before Film Looks.
Primary correction should preserve that order:

```text
source decode → HDR tone map when required → primary correction → Film Look
```

Temperature, exposure and contrast need a versioned contract, film/beat/clip
scope, typed commands and shared preview/render coefficients. Auto Match must be
a measured suggestion with before/after evidence, not a silent source mutation.

### Catalog, proxy and Collect Media

The catalog is v6. Existing import creates per-asset, source-hash-keyed,
project-relative 640×360 video proxies and audio proxies; Desktop prefers them
for supported preview. This is not cross-asset content deduplication. The gap is
an independent proxy lifecycle with queue, cancel/resume, stale-hash fencing,
quota/eviction, rebuild and health UI.

Collect Media already streams deterministic stored ZIP entries and validates
revision, hash, path, rights, cancellation and relocation. It does not load an
entire package into memory, but its ZIP32 limits and full-original I/O constrain
large projects. A v2 plan may add `originals | trimmed-originals | proxies`.
Trimmed mode unions used source ranges, clamps configurable handles, records
original-to-derivative hashes and reopens against derived assets. Proxy-only mode
must be labelled offline edit and cannot claim finishing-quality export.

### CI, native distribution and extension data

Synthetic test media already use FFmpeg generators. The reproducibility gap is a
fixed licensed test font, recorded/pinned FFmpeg evidence and one centralized
metric policy. Source, fixture, font, tool, manifest and receipt hashes plus
rational structure/timing remain exact. Encoded-output SHA is recorded for
provenance, not treated as a cross-platform oracle; narrowly justified channel,
SSIM or bounding-box tolerances apply only to decoded raster/codec variation. A
deliberate one-frame and one-pixel failure control must prove tolerances do not
hide errors.

The native runtime contract and stager require reviewed Node, FFmpeg/FFprobe, CJK
font, SBOM and licenses, and synthetic runtime tests exercise that shape. The
repository does not contain an audited target runtime artifact, the installer
workflow has not dispatched one, and bundling remains disabled by default.
Release still requires compatible GLib `RUSTSEC-2024-0429` remediation **and** a
reachability review plus re-audit, Windows/macOS signing/notarization,
clean-machine install, first-run, update, failure rollback and uninstall evidence.

Plugin Manifest v1 exists. Executable plugins are trusted code, while their
discovery/loading remains wholly deferred. The D8 candidate supplies a separate
local single-JSON Film Look/Story/Title schema with strict unknown-field, depth,
size, numeric, ID, license and provenance validation. Shared CLI/API/Desktop
review and explicit acceptance feed existing owners. Immutable embedded recipes
survive registry removal and Collect relocation; actual synthetic render/seek,
collision/recovery and legacy-reopen evidence is recorded in
[D8 validation](../validation-local-presets.md). Independent review and full
integration/hosted gates remain open. This does not broaden the executable
plugin contract.

## Hard dependencies and delivery order

```text
saved Composition + application/typed-command owners
  ├─ D2 continuity diagnostics
  ├─ D3A1 Sequence waveform / D3A2 rhythm evidence
  ├─ D3B1 J/L audio-policy primitive ──▶ D3B2 typed visual coverage
  ├─ D4 transcript compound edit + cross-track retime policy
  ├─ D5A photo presentation
  ├─ D5B title finishing
  └─ D5C primary color

existing proxy generator ──────────────── D6A proxy lifecycle
existing Collect planner/verifier ─────── D6B derived package modes
synthetic fixtures ────────────────────── D7A reproducible render CI
runtime contract/stager + security gates ─ D7B native release closure
manifest + bounded validators ─────────── D8 data-only preset registry
```

These are hard technical owners, not a claim that every branch depends on D2 or
D3A. D3A sub-slices and D3B designs can progress independently, but D3B2 product
implementation depends on the D3B1 policy primitive/evaluator. D4 depends on
transcript revisions and a safe compound operation, not on rhythm analysis.
D5A/B/C each extend their existing evaluator directly. D6A is the preferred
delivery predecessor to D6B
for operational UX, but derived Collect modes can be designed against the
existing generator and planner without treating M2/M3 or D6A as a schema-level
dependency.

The accepted Multi-source M2 → M3 work remains the next delivery priority, not a
hard dependency of every creative or portability increment. No item may bypass
the shared application, Composition, catalog or typed-command owners.

## Pre-implementation safety gates

Before product code, D2B transition semantics, D3A2 analysis evidence, D3B1
audio semantics, D3B2 Story coverage, D4 transcript ripple, D5A photo contract,
D5B title contract, D5C color processing, D6B media consolidation, D7B installer
sidecars/runtime inputs and D8 plugin/preset schemas each require an independent
threat/compatibility design and implementation plan. Each design must name
trusted inputs, path/network/code-execution boundaries, revision/lock/stale
behavior, failure rollback, legacy reopen/migration, unknown-version fail-closed
handling, preview/render/interchange behavior and actual media evidence. Approval
of this roadmap does not waive those gates or combine the slices into one
implementation PR.

## Existing-owner crosswalk and proposed slices

| Order | Existing owner / proposed slice                                          | Authority / reuse                                              | Exit behavior                                                                                                                                                 |
| ----- | ------------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D0    | Proposed: truth and evidence reconciliation                              | Current docs, Git history and merged contracts                 | Current v6/release/PR history is accurate; each proposal is classified and no existing subsystem is queued from scratch                                       |
| D1    | Existing owner: Multi-source M2 then M3 delivery priority                | Existing SourceDraft, catalog v6 and accepted roadmap          | Existing M2/M3 checkboxes remain authoritative; this reconciliation adds no duplicate implementation queue                                                    |
| D2A   | Existing Story Arc shot-adapter owner: continuity diagnostics            | StoryPlan, saved Composition and Scene Direction review        | Typed-evidence diagnostics; unavailable shot language is manual review; override, locks/stale/reopen and real MP4 evidence                                    |
| D2B   | Proposed after transition compatibility design: scene micro-preview/dips | Existing crossfade and Scene Direction review                  | Bounded adjacent-scene micro-preview and Dip-to-Black/White parity without rebuilding crossfade; advisory emotion guidance remains with the Story Arc adapter |
| D3A1  | Existing Professional Cut Desk Phase 3 owner: Sequence waveform          | Existing peaks plus source-range and frame-range resolvers     | Trim/speed/source-range/frame-safe projection, repeated-source clips and no peaks beyond clip end                                                             |
| D3A2  | Proposed after analysis/reliability design: rhythm evidence/proposals    | Generic beat-priority snap primitive; no current beat producer | Source-bound onset/downbeat/phrase evidence, reliability disclosure and explicit bounded solver snap acceptance                                               |
| D3B1  | Existing Professional Cut Desk Phase 3 owner: J/L audio policy           | Existing Composition plus new versioned policy/evaluator       | Default `keep-primary`, explicit `mix-secondary \| replace-primary`, role/gain mix plan, exact timing and no double mix; no coverage persistence              |
| D3B2  | Proposed after Story/solver design and D3B1: A/B visual coverage         | New typed coverage operation using the D3B1 policy             | Persist coverage/policy/role/gain/revision/source-hash receipt, locks/stale/Undo/reopen and no second timeline                                                |
| D4    | Proposed after threat/compat design: transcript ripple                   | Transcript revisions plus new application compound operation   | Reliable timing only, explicit cross-track retime/conflicts, one history step, SRT/VTT and output alignment                                                   |
| D5A   | Existing F05 owner: tactile photo presentation                           | Existing focal/layout/motion evaluator                         | Preview gizmo, ambient fill parity and separately versioned bounded custom easing                                                                             |
| D5B   | Existing F05 owner: bilingual title finishing                            | Existing measured title raster                                 | Independent runs, bounded shadow/stroke/pill styles, missing-font evidence and MP4 parity                                                                     |
| D5C   | Proposed after color/compatibility design: primary color                 | Existing tone map and scoped Film Looks                        | Shared coefficients and fixed processing order; Auto Match is reviewable evidence only                                                                        |
| D6A   | Existing Cut Desk Phase 2–4 owner: proxy lifecycle                       | Existing proxy generator and portable cache                    | Bounded queue, cancellation, stale hash, quota/eviction, rebuild and health                                                                                   |
| D6B   | Proposed after threat/compat design: Collect Media v2 modes              | Existing Collect planner/verifier                              | Derivative receipts, handles, relocation/reopen, baseline frame/audio/time parity and explicit offline-quality disclosure                                     |
| D7A   | Existing F13 owner: reproducible render CI                               | Existing synthetic fixtures                                    | Fixed font/tool evidence, metric tolerances, deliberate failures and focused OS matrix                                                                        |
| D7B   | Existing M7E/GLib owners: native release closure                         | Verified runtime contract/stager                               | Audited target artifact, security, signing, install, first-run, update, rollback and uninstall gates                                                          |
| D8    | Candidate after approved design; focused evidence, final review pending  | Existing validators, editor, StoryPlan and render owners       | Local single-JSON packages, declared-license acceptance, atomic recovery/CAS, portable snapshots and actual Monitor/FFmpeg/Collect evidence                   |

Each implementation PR updates `TASKS.md`, `ROADMAP.md` and a validation record.
It reports exact base/head, changed paths, fresh tests, actual FFmpeg evidence,
correctness blockers and manual gates. A phase remains incomplete when any named
acceptance behavior is not implemented.

## Acceptance and risk matrix

| Area              | Automated acceptance                                                                                                                                                                                                    | Manual / correctness boundary                   | Principal risk                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------- |
| Continuity        | Synthetic adjacent motion/duration/density, typed-evidence warnings, missing-evidence manual review, override, stale/lock/history/reopen and source receipts                                                            | Human editorial quality                         | Presenting absent evidence or a heuristic as objective quality        |
| A/B-roll          | Narration continuity, multiple B-roll ranges, default `keep-primary`, explicit role/gain modes, exact decoded timing, Undo/reopen receipt, no double mix or source mutation                                             | Real documentary pacing/listening               | Hidden second timeline, duplicate audio or drift                      |
| Waveform/beat     | Pulse fixtures, source-in/out and duration clamp, trim/speed/frame projection, repeated-source clips, onset timestamps, bounded snap and opt-out                                                                        | Real music phrase quality                       | False precision or a divergent clock conversion                       |
| Scene transitions | Edge-clamped previous-2s/current-3s preview, ephemeral proposal, cancel/stale/project-switch, arbitrary seek, Dip-to-Black/White decoded first/middle/last frames, Monitor/MP4 parity and existing crossfade regression | Human pacing/taste                              | Hidden edit state or preview/output offset drift                      |
| Transcript ripple | Synthetic narration, reliable interval mapping, caption/graphic/overlay/duck retime or typed conflict, one history step and caption/export alignment                                                                    | Ambiguous speech and editorial judgment         | Deleting estimated speech or silently stranding another track         |
| Photo/title/color | Shuffled seeks, first/middle/last pixels, CJK metrics, SDR/HDR chart, preview/output parity                                                                                                                             | Faces, private photos and calibrated displays   | Divergent browser/FFmpeg math                                         |
| Collect/proxy     | Long-GOP ranges, overlap union, handles, derivative hashes, cancellation/races, relocation and decoded picture/audio/time parity against the original project                                                           | Large external drives and finishing workflow    | Source-offset drift, lost provenance or presenting proxies as masters |
| CI/native         | Exact source/font/tool/manifest hashes and rational structure/timing, recorded encoded SHA, narrow decoded metrics, deliberate tolerance failures and focused OS jobs                                                   | Signing, notarization, clean machines, hardware | Green synthetic CI overstating release readiness                      |
| Presets           | Malformed/deep/large/path/NaN/collision rejection, legacy reopen and parity                                                                                                                                             | Community governance and licensing review       | Turning data presets into executable plugins                          |

## Release decision

No milestone in this queue is automatically `v1.0.0`. A stable version is chosen
only after its included contracts have no correctness blocker, exact-head CI is
green, security/license evidence is current, and every unrun workstation gate is
explicitly disclosed. Native installers are candidates until the distribution
closure above is completed; they must not be described as a formal release on
the strength of Linux synthetic CI alone.
