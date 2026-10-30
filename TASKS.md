## Professional Cut Desk — Phase 1A

Scope: [approved design](docs/superpowers/specs/2026-10-26-professional-cut-desk-design.md),
[plan](docs/superpowers/plans/2026-10-26-professional-cut-desk-phase-1a.md),
[guide](docs/professional-cut-desk.md) and
[validation](docs/validation-professional-cut-desk.md).

- [x] Versioned rational timebase, exact DF entry/display and same-rate update policy.
- [x] Shared Composition resolver, continuous Record transport and existing Source ownership.
- [x] Revision-bound Source I/O, acknowledged atomic Apply/split and session Undo/Redo.
- [x] Source-only markers, target-aware keyboard guards and operation-specific locks.
- [x] Produce synthetic FFmpeg/browser/accessibility evidence and an exact-head gate record;
      retain first-run failures and rerun the complete sequence after compatibility corrections.
- [x] Hosted Linux Rust/Tauri/archive/build gate passes; local Cargo remains unavailable.
      Physical desktop/workstation verification remains below.
- [ ] Phase 1B: monitor layout, Edit Decision Ribbon, compare and precision gestures.
  - [x] Selectively recover General Story-monitor clip-picture move and
        proportional corner resize through the current geometry and atomic
        transaction boundaries; preserve cancellation, locks, Undo/Redo,
        autosave/reopen and 44 px coarse-pointer targets.
  - [x] Add the Expert Edit Decision Ribbon and diagnostic film-look compare
        workflow from the active Composition resolver; preserve media identity,
        keyboard/pointer cancellation, context fencing and output immutability.
  - [ ] Complete the remaining solver-backed pointer-centred Precision zoom/pan
        and snap-bypass gestures without introducing a second timeline.
- [ ] Phase 1C: complete responsive/resizable workspace and accessibility program.
- [ ] Phase 2–4: new edit semantics, tracks/proxies/audio control and finishing tools.
  - [ ] D3A1: project existing source peaks into Sequence time with shared
        source-range and rational-frame resolvers, including trim/speed/clamps.
        Implementation and 72 focused/seven browser regressions are complete;
        exact-candidate gates/review remain pending. See the
        [guide](docs/sequence-waveforms.md) and
        [decoded MP4 evidence](docs/validation-sequence-waveforms.md).
  - [ ] D3B1: after an edit/audio compatibility design, add the versioned
        audio-policy primitive/evaluator for J/L mechanics; default B-roll to
        `keep-primary`, with explicit role/gain modes and no coverage persistence
        or implicit/double mix in this slice.
  - [x] D6A: add bounded proxy queue, cancel/resume, stale-hash fencing,
        quota/eviction, rebuild and health UI through the existing generator.
        Implemented in PR #64; independent review corrections, 4464 full local
        tests and 10 focused browser workflows pass. All 288 Chromium and hosted
        checks remain merge gates; exact status is recorded in the PR and
        [validation](docs/validation-proxy-storage.md).
- [ ] Physical Windows/macOS keyboard/trackpad, hardware audio latency, high-DPI,
      color-managed displays and long-form workstation verification.

## Windows workflow recovery — issues66–68

Scope: [issue plan](docs/superpowers/plans/2026-10-30-windows-issue-recovery.md)
and [validation](docs/validation-windows-issue-recovery.md). Based on merged main;
these narrow regressions do not close physical workstation/installer gates.

- [x] #66: replace retired FFmpeg frame-sync option; real PNG/crop/MP4 and
      delivery-rate regression with independent decode.
- [x] #67: preserve file durability and make directory-sync capability explicit
      across browser scan receipts, source staging and stage index; verify
      scan→stage→reopen→seal and fail closed on real file/POSIX errors.
- [x] #68: quiesce benchmark page, require close acknowledgement/no open project
      before bounded fixture cleanup; preserve measurement budgets/artifacts.
- [x] Fresh source reviews, full available gates and actual Windows/FFmpeg9
      evidence:121tests/13browser;4591full unit/integration and291Chromium.
      Exact final integration/main outcomes are recorded on PR69; merge requires green gates.
- [ ] Manual: exact candidate rerun on Windows10/popopc; broader issue7 gates.

## CI contract/media separation

Scope: [design](docs/superpowers/specs/2026-10-30-ci-contract-media-design.md),
[plan](docs/superpowers/plans/2026-10-30-ci-contract-media.md), and
[validation](docs/validation-ci-contract-media.md). Independent of physical QA.

- [x] Split pure core/solver/story/metadata/events and heavy-by-default test
      discovery; reject omitted, overlapping, duplicated, escaped or empty inventories.
- [x] Preserve all format/locales/lint/types/build/interchange/CLI/browser gates and
      unchanged native job; keep the legacy check mandatory for both lane successes.
- [x] Full evidence/review/hosted gates; PR70 merged as8de63ae after1124contract
      +3427media tests,291browser,23Rust,2archive,18interchange and security checks.
- [ ] Manual hardware/NLE/installer observations remain with their existing owners.

## CI delivery reliability and E2E duration

Scope: [design](docs/superpowers/specs/2026-10-30-ci-pages-e2e-design.md),
[plan](docs/superpowers/plans/2026-10-30-ci-pages-e2e.md) and
[validation](docs/validation-ci-pages-e2e.md).

- [x] Reproduce main Pages dead links; fix both architecture links and require
      the actual VitePress build on every PR/main candidate.
- [x] Run complete E2E on four isolated single-worker VMs alongside media QA;
      reject discovery omissions/overlaps and skipped/flaky/missing actual results.
- [x] Bind browser receipts to the exact candidate and require every lane in the
      existing aggregate; avoid duplicate feature push plus PR Verify runs.
- [x] Independent review correction and exact source gates:4591tests/291browser;
      measured E2E23m24s→11m18s and Verify34m39s→12m55s. PR71 merged into PR69.
      Final integration/main Verify and Pages evidence are recorded on PR69;
      main merge requires all final checks.

## In progress — Multi-source import and common analysis

Scope: [roadmap](docs/roadmap/multi-source-analysis.md),
[implementation plan](docs/superpowers/plans/2026-10-25-multi-source-analysis.md),
and [validation](docs/validation-multi-source-analysis.md).

- [x] M0: define separate ImportBatch, AnalysisRun and JobAttempt state machines,
      typed source/manifest/review contracts and dotted error identifiers.
- [x] M0: add catalog schema v6, classify every durable table and filter selected
      source/content evidence from Collect Media snapshots.
- [x] M0: preserve immutable schema-v5 Named Version inspect/diff behavior and
      privately upgrade asset-aware restore/rebase paths without changing
      historical payload hashes.
- [x] M1: additive native/browser source draft, multi-folder picker, bounded
      typed drop classification, IndexedDB handles, expired-file disclosure and
      General/Expert views. The same project-owned application service backs
      Desktop and HTTP; selection remains non-destructive and does not start an
      import until the user explicitly continues. Native workstation picker
      execution remains an M7 manual gate because this environment has no Rust
      toolchain.
- [x] M1 review hardening: fence delayed picker results, reload stale revisions,
      keep upload cancellation reachable, prevent shallow folders entering the
      recursive compatibility importer, and transactionally batch/release
      browser access records with real Chromium IndexedDB reopen coverage. Keep
      draft-read and native-listener lifecycles separate; reconcile ambiguous
      add/remove/update results with the same idempotency receipt and an
      authoritative draft before releasing browser access.
- [x] M1 UI/UX hardening: batch browser permission reads, page large drafts at
      100 source cards without changing the authoritative selection, keep
      technical revision/path controls behind Expert or progressive disclosure,
      expose typed rejection reasons, and preserve 44px coarse-pointer targets,
      CJK wrapping, keyboard navigation, narrow-screen reflow and stale-project
      interaction fencing.
- [x] M0/M1 independent-review closure: rebuild every retained portable v6 JSON
      payload from explicit semantic columns, scrub logical/relative locators,
      verify a pinned catalog produced by the real schema-v5 code, align the
      documented 10,000-source boundary with a 4 MiB compact draft, index
      IndexedDB by project, recover blocked opens, bound permission checks to 16,
      limit persistent checks to the visible 100-card page, and roll failed
      recursion controls back to authoritative state.
- [x] M0/M1 final blocker closure: preserve typed manifest/review/failure data and
      only bounded numeric/boolean structures from uncontracted analysis evidence;
      verify a full hash-pinned v5 Named Version package, linear 4 MiB receipt
      pruning, keyed handle reads, structural SQLite metadata and atomic ambiguity
      rejection beyond 32 indistinguishable same-name browser handles. Independent
      final review found no remaining Critical, Important or Minor issue; 3,904
      Vitest and 234 Playwright tests pass on the corrected code head.
- [x] M2: streaming discovery, paged many-to-many membership, private staging,
      full-content identity and immutable Expected/Verified Manifests; 10,000-item
      cancellation/backpressure and restart/retry boundaries are covered.
- [x] M3: manifest-scoped common event/duplicate analysis, owner-fenced durable
      attempts, cancel/retry, stale-result fencing and shared Desktop/HTTP/CLI
      application logic.
- [x] M4: versioned manual device-clock evidence, bounded GPX parsing/assignment,
      conflict preservation, and segment-safe matching with no gap interpolation.
- [x] M5: deterministic actual-FFmpeg representative frame samples, sample-only
      provider input, explicit remote consent, receipts, retry and source-hash
      invalidation.
- [x] M6: immutable typed review decisions, search, preview, operation/result/
      manifest/story preconditions, conflict/supersession and explicit StoryGraph
      adoption with save/reopen recovery coverage.
- [x] M6 interaction/recovery: exact-form preview fencing, ordered search and
      zero-result state, durable same-receipt acceptance retry/reopen, explicit
      conflict supersession, custom graph IDs and owning-workspace refresh.
- [x] M6 final independent review and full revalidation: 306 files / 4,397
      Vitest tests and 284 Chromium tests passed; workstation gates remain open.
- [x] M2–M6 review closure: discovery-bound staging, closed travel privacy,
      non-blocking owned cancellation, verified sampling snapshots, transactional
      publication fences, live-reader ownership, reviewed result projections,
      real source bounds and multi-result adoption.
- [x] M7 automated: format, i18n, lint, typecheck, Vitest, build, Chromium E2E,
      interchange and docs locale gates. Exact evidence is in the validation log.
- [ ] M7 workstation: native Rust/Tauri, physical Windows/macOS picker and
      permission reopen, external-drive stress, and real Resolve import remain
      unverified; no hardware or platform behavior is claimed from this runner.

## Seven-subsystem evidence reconciliation and next stable queue

Scope: [current-state evidence and dependency map](docs/roadmap/seven-subsystem-reconciliation.md).

Delivery goal: [v1.0.0 readiness and existing owner crosswalk](docs/roadmap/v1-readiness.md).
The published stable remains v0.4.0; release follows verified exit conditions.

- [x] Reconcile Story, photo/render, Cut Desk/audio, transcript/title, color,
      catalog/portability and cross-platform claims against current source,
      contracts, regressions and Git history.
- [x] Correct current Catalog v6, released-v0.4.0 versus unreleased-main and
      historical subtitle/Named Version wording without rewriting historical
      v5 compatibility evidence.
- [x] D1 dependency: keep the existing Multi-source M2 and M3 items above as the
      only authoritative implementation queue; do not duplicate their checkboxes.
- D2 crosswalk: the nested D2A item under the existing emotional-overlay/
  shot-proposal owner is authoritative for typed-evidence continuity diagnostics,
  advisory emotion guidance and `manual-review` when shot language is absent.
- [ ] D2B: after a transition compatibility design, add bounded adjacent-scene
      micro-preview and Dip-to-Black/White through the existing transition owner;
      reuse rather than rebuild the implemented crossfade.
- D3A1 crosswalk: the nested Professional Cut Desk Phase 3 item is authoritative for background
  waveform preparation and Sequence projection through the existing source-range
  and rational-frame contract.
- [ ] D3A2: after an analysis/reliability design, add source-hash-bound
      onset/downbeat/phrase evidence and an explicit bounded solver snap proposal;
      do not imply the existing generic snap primitive produces beat markers.
- D3B1 crosswalk: the nested Professional Cut Desk Phase 3 item is authoritative for J/L-cut
  mechanics and explicit embedded-audio policy on the existing Composition.
- [ ] D3B2: after a Story/solver coverage design, add reviewable A-roll/B-roll
      visual coverage roles and proposals that persist the D3B1 policy receipt;
      product implementation depends on D3B1 and introduces no second timeline.
- [ ] D4: design and implement reliable-timing-only Transcript ripple proposals
      through one application-level compound operation with typed cross-track
      retime/conflict policy; estimated timing must fail closed.
- D5A/D5B crosswalk: the nested open F05 photo/title items are authoritative for
  focal interaction, ambient fill, versioned bounded custom easing and bounded
  bilingual title finishing.
- [ ] D5C: after an independent color/compatibility design, add versioned primary
      correction before Film Looks. Auto Match remains reviewable measured
      evidence, never a source mutation.
- D6A crosswalk: the nested Professional Cut Desk Phase 3 item remains authoritative for proxy
  lifecycle; use the existing generator and add cancel/resume, stale fencing,
  quota/eviction, rebuild and health acceptance there.
- [x] D6B: add Collect Media trimmed-original and explicitly offline proxy modes
      with derivative provenance, handles, relocation/reopen, decoded
      picture/audio/time parity against the original project baseline and
      explicit quality disclosure.
  - [x] Read-only delivery/coverage contract, saved baseline/hash/revision capture,
        portable-clock protection and shared CLI/API/three-locale review UI.
        [Delivery evidence](docs/validation-collect-coverage.md).
  - [x] Generate/verify bounded lossless derivatives, piecewise clock receipts and
        v2 directory/ZIP relocation against every selected original decoded baseline;
        retain protected/VFR/unsupported clocks on originals. Preserve default v1.
  - [x] Explicit revision-bound CLI/API/Desktop acceptance and persistent offline
        quality disclosure; source/project/catalog/locks/captions remain unchanged.
  - [x] Reproduce/fix ready-preview hard-link cleanup race found in checkpoint CI;
        preserve full hash, alias and corruption assertions.
  - [x] Independent review: precision-preserving source validation, fresh review
        acceptance, bounded Verify cleanup, native/baked NLE offline lineage;
        regression-backed fixes. Keep warning-detail presentation as follow-up.
  - [x] Complete local full gates: 4535 unit/integration,291 Chromium, official
        OTIO18, built CLI smoke, types/lint/build/format/i18n/docs.
  - [x] Complete exact-head hosted gates and merge PR65: head608377a,
        merge5160d8f; both PR/push checks pass including4535tests,291browser,
        23Rust and2archive tests. Physical workstation gates stay open.
- D7A crosswalk: the nested open F13 item is authoritative for a licensed
  fixed test font/tool record, metric-specific tolerances, deliberate failure
  controls and focused Windows/macOS render evidence.
- D7B crosswalk: the released-0.4.0 GLib gate and M7E installer checkboxes remain
  authoritative for remediation **and** reachability re-audit, audited runtime,
  signing/notarization, clean-machine install, update, rollback and uninstall.
- [ ] D8: add a strict local data-only preset registry without enabling project
      JavaScript, HTML, remote URLs or an unreviewed executable marketplace.

Before product-code changes, D2B transition semantics, D3A2 analysis evidence,
D3B1 audio semantics, D3B2 Story coverage, D4 transcript ripple, D5A photo
contract, D5B title contract, D5C color processing, D6B media consolidation, D7B
installer sidecars/runtime inputs and D8 plugin/preset schemas each require an
independent threat/compatibility design and implementation plan. These gates are
contract work, not permission to bundle the slices into one PR.

No queue item implies a version number. The next stable version is selected only
after its included contracts and exact-head/manual gates are known.

## Released 0.4.0 — review remediation and integration

- [x] Fix named-version source fencing, collision-free/order-aware diffs and linear source validation.
- [x] Add explicit confirmed deletion through shared application/API/CLI/Desktop to free bounded version capacity without automatic pruning.
- [x] Cover stale/confirmation/retry/recovery/reopen and synthetic source-change regressions.
- [x] Fix and independently review all six feature PRs 35–40; preserve their ancestry on integration PR #41.
- [x] Verify complete combined format/i18n/lint/typecheck/unit/application/build/interchange gates and actual shared render/package parity.
- [x] Align application/workspace/Tauri metadata at 0.4.0 while retaining project schema 1.0.0 and Apache-2.0/NOTICE.
- [x] Close final integration review findings: installed CLI version, empty ZIP/abort/ownership, and complete native FFmpeg filter admission; rerun the combined gates.
- [x] Independently close all 16 late feature/integration findings, including scene schema/seek, delivery/caption fences, passive NLE review and atomic directory/stem publication; verify the pinned native dependency and its license inventory.
- [x] Preserve saved project revisions and unrelated jobs during CLI export; prove durable cross-process retries and retained source/settings rejection with the actual built executable.
- [x] Fix supported FFmpeg 6.1.1 singleton/low-frame-rate delivery without changing saved project rates; retain the original browser case and independently verify actual decoded output on 6.1.1 and 7.1.5.
- [x] Fence saved revisions and cancellation after real ZIP creation, publish synchronously without replacing destinations, and preserve postcommit outputs; independently verify actual archive races.
- [x] Remediate the failed JavaScript advisory gate with exact Vite 8.2.4, verified registry/provenance, zero-audit and bounded launcher/build/native/browser controls; see [validation](docs/validation-vite-security.md).
- [ ] Resolve the existing GLib 0.18.5 / `RUSTSEC-2024-0429` native distribution gate through compatible upstream remediation and reachability review before publishing installers.

The Vite-patched candidate repeated the required combined/browser/hosted gates
before the tagged release. Final browser/native CI, merge and publication status is recorded on
[integration PR #41](https://github.com/bynanci/open-film/pull/41) and the
[0.4.0 source release](https://github.com/bynanci/open-film/releases/tag/v0.4.0).
Exact base/head/merge identities, changed paths and completed gates accompany the
checksummed release evidence. Installer/workstation/manual gates remain open.

## M6 — Audio Quality and Provider Generation

- [x] Reuse existing AudioAutomation and typed volume edits.
- [x] Measure decoded actual MP4 integrated loudness, sample/true peak and meters.
- [x] Review role-based constant gain with original/candidate A/B and preserved curves.
- [x] Fence saved revisions, sources, private cache, cancellation and stale playback.
- [x] Separate PR #32, independent review and full local gates; evidence in [validation](docs/validation-audio-quality.md).
- [x] PR 6B: general TTS adapter with local mock/BYOK, ProviderRegistry consent,
      unknown-cost acknowledgement and explicit preview/accept/import.
- [x] Revision/history-safe managed-source handoff, cancel/late-result fencing,
      durable accepted receipts and restart recovery.
- [x] Actual synthetic MP4 time/source-hash evidence, focused normal/delayed/lost
      response browser regressions and full unit/application gates.
      Final full-browser and exact-head CI/merge outcomes are recorded in the PR verification report; merge requires success. See [validation](docs/validation-provider-generation.md).
- [ ] Live paid TTS/pronunciation, provider billing/terms and hardware listening QA.

The current M6 request splits audio finishing and provider generation. The older
F05 photo-framing expansion stays deferred; this does not relabel it as complete.

# Task status

This checklist includes released v0.4.0 history and later unreleased `main`
development. A checked item means behavior or a concrete artifact exists; it
does not certify every operating system or downstream NLE. Commands and test
responsibilities are in
[README.md](README.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## In progress — Story Arc Authoring and Story-to-Pipeline flow

- [x] Apply the Quiet Studio component redesign: carbon/pearl/blue tokens, shared
      control/panel/dialog geometry, grouped top bar and calmer media/story views.
- [x] Reproduce/fix 1280px Expert toolbar wrapping and invisible touch media
      actions; keep native keyboard switching and 44px coarse-pointer targets.
- [x] Move the actual App-owned export preview alongside settings on desktop,
      with stacked compact layout; preserve existing native player/render behavior.
- [x] Complete the redesign's local regression gates (278 files / 3,819 tests,
      54 relevant browser cases), preserve review fixes and prepare the branch update;
      record exact local gates and remaining workstation limits in
      [validation](docs/validation-quiet-studio-redesign.md).
- [x] Close PR #53 review and full-suite regressions for IME persistence, arc
      localization/timing, Pipeline shortcut isolation, loopback image CORS,
      progressive disclosure and compact Export geometry; pass 278 files / 3,821
      tests and the complete 228-case browser suite from the final files.

Scope and contract: [Story arc authoring](docs/story-arc-authoring.md),
[design](docs/superpowers/specs/2026-10-23-story-arc-authoring-design.md) and
[validation](docs/validation-story-arc-authoring.md). Base is
`b39c2c369d584fa0bb4f75734737d4ebd68d928a`; the existing M9 StoryGraph,
M9 StoryPlan and M10 Pipeline Workbench are reused.

- [x] Add localized journey, event recap, then-and-now, portrait, day-in-life,
      letter and memory-collection starters while retaining blank and Proposal Film.
- [x] Accept a bounded user-authored outline in the specified order; keep beats
      without media visible and avoid candidate reuse.
- [x] Open newly created stories in StoryGraph and expose the existing
      StoryGraph → Pipeline → Compose/Edit workflow.
- [x] Present Storyboard beats as an accessible vertical reading thread.
- [x] Pass focused unit, API/reopen, i18n and typecheck checks.
- [x] Complete browser, full-suite, format, lint, typecheck and production-build
      verification; exact results are recorded in the validation document.
- [x] Review the supplied cinema-foundation v1.1.0/v1.0.0 guidance and verify
      their manifests; record available reference contracts and provenance.
- [ ] Review/adapt the supplied emotional-overlay and shot-proposal contracts,
      including scene/shot ID mapping and sidecar revisions, before runtime integration.
  - [ ] D2A: derive motion/duration/density continuity diagnostics from typed
        saved evidence; missing shot-scale/eyeline evidence stays manual review.
- [x] Refine story setup with authored-order preview, field validation and
      draft/focus recovery; keep the existing project/schema/edit contracts.
- [x] Correct storyboard covered duration and cross-story mapping, distinguish
      offline sources and no selection, and add accessible source previews.
- [x] Add keyboard story tabs, skip navigation and empty-search recovery.
- [x] Complete workspace UX regression/visual gates (275 files / 3,781 tests,
      29 relevant browser cases); record the corrected shared-port scheduling in
      [validation](docs/validation-workspace-ux-refinement.md).
- [x] Apply graphite/mist/iris workspace colors, distinct control boundaries,
      responsive gutters/panel insets and fewer nested frames.
- [x] Fix 768px inspector overflow, 640px export preview sizing, excessive
      inspector/beat-rail height and expanded StoryGraph toolbar/Fit geometry.
- [x] Repair StoryGraph beat autosave's duplicate API prefix through the existing
      beat-save path; cover pending edits, fenced selection, failed-save retry/focus
      and reopen.
- [x] Keep theme-switch label contrast accessible throughout the transition;
      retain border/opacity motion and verify rendered frame samples.
- [x] Complete the responsive surface / palette gates (275 files / 3,788 tests,
      37 relevant browser cases); record window and
      zoom-equivalent reflow evidence in [validation](docs/validation-responsive-surfaces.md).

- [x] Add General/Expert device modes with shared Settings/header controls,
      progressive tool disclosure and responsive expert density.
- [x] Add whitelisted, localized Quick actions with native dialog focus,
      keyboard navigation, draft/review gates and stale-session fencing.
- [x] Complete workspace-mode integration gates (278 files / 3,819 tests,
      48 relevant browser cases) and record real results in
      [validation](docs/validation-workspace-modes.md).
- [x] Add pointer-based StoryGraph movement and expert connection handles with
      live typed-edge preview; retain a keyboard-accessible Inspector composer
      in General mode and keep layout state revision-neutral.
- [x] Route beat/asset and beat/beat connections through shared application
      operations so selected assets and canonical story order remain authoritative;
      reject duplicate, self and cyclic links without saving a partial graph.
- [x] Rework Pipeline Workbench around one focused 5-gate flow; expose the fixed
      8-task recipe, task IDs, dependencies and diagnostics only in Expert mode.
- [x] Complete the final available repository gate matrix for the StoryGraph
      connection / Pipeline flow candidate: 3,831 Vitest and 230 Chromium cases,
      build and OTIO interchange pass. Native was attempted but this environment
      has no `cargo`; exact evidence is recorded in
      [validation](docs/validation-story-connections-pipeline-flow.md).

## Implemented — M3 / F01 Declarative GraphicScene

Scope: [GraphicScene v1](docs/graphic-scenes.md),
[threat model](docs/security/graphic-scene-threat-model.md) and
[validation](docs/validation-graphic-scene.md). This explicit M3/F01 scope replaces
previous M3/F03 general keyframe authoring; broader clip keyframes stay deferred.

- [x] Strict versioned Image/Text/Shape/Group data, bounded geometry/time/easing
      and deterministic arbitrary-seek evaluation without project code or URLs.
- [x] Existing commands/history/autosave/reopen and duration-conflict protection;
      no second timeline, project-schema migration or original-media overwrite.
- [x] Shared bounded PNG raster for Edit Monitor and FFmpeg; scene-only source/font
      hash evidence, portable JSON/OTIO metadata and explicit NLE limitations.
- [x] Accessible Graphics Inspector with three-locale text and sampled playback;
      paused seek uses the exact output frame and stale results are withheld.
- [x] Actual synthetic 6-second/180-frame MP4, decoded first/mid/last pixels,
      shuffled seek, source-change/cancel/cache regressions and M1 QA integration.
- [x] Whole-branch review with regression-tested corrections and automated gate
      matrix; exact-head CI is required and recorded in the PR before merge.
- [ ] Manual hardware/4K throughput, target-display aesthetics and real NLE finishing.

## Implemented — M4 / F02 Creative Story Templates

Scope: [Creative Story Templates](docs/creative-story-templates.md),
[architecture](docs/architecture.md#creative-story-template-records) and
[validation](docs/validation-creative-story-templates.md). M4 is integrated in
PR #29 at `e6d07b04cfb7ae905e04a6102311a26da1f18e01`.

- [x] Bind Conversation Card, Route Story and Photo Relationship metadata to
      ordinary GraphicScene v1 nodes without another timeline or project migration.
- [x] Retain exact chat source/citation and excerpt ranges; parse only explicitly
      selected bounded GPX files and save source hash plus route geometry.
- [x] Provide a localized Gallery/Inspector for text, timing, source photos,
      animation, focal point and protected-region edits.
- [x] Persist scene and record through existing typed commands, Undo/Redo,
      autosave and reopen; deleting a scene deletes its metadata record.
- [x] Cover safe GPX parsing, all three template types, real synthetic 24-second
      MP4 decode evidence, source hashes, browser authoring and history/reopen.
- [x] Complete exact-head CI, fresh review and merge M4 before starting M5;
      published/manual workstation and private-film gates remain separate.

## Implemented — M5 / F03 Layer Editor (PR 5A)

PR #30 is merged into `main` at `a33340c43d40f82825bc788e1c82625883e6acbb`.
Its base `e6d07b04cfb7ae905e04a6102311a26da1f18e01` contains integrated M3/M4.
Scope and implementation contract: [GraphicScene v1](docs/graphic-scenes.md),
[architecture](docs/architecture.md#declarative-graphicscene) and
[validation](docs/validation-layer-editor.md).

- [x] Select visible scene objects in the existing paused Monitor and edit their
      position, size, rotation, opacity and z-order through typed scene commands.
- [x] Add hidden/locked state, lock-aware group/scene protections, 8-pixel and
      sibling-center snapping, alignment guides and arrow-key nudging.
- [x] Preserve existing revision, autosave, history, Undo/Redo and reopen
      behavior; cancel stale preview/gesture work and reset selection on project
      or Composition changes.
- [x] Verify optional fields remain compatible with legacy scenes and compare
      Monitor PNGs with decoded pixels from a synthetic 6-second MP4.
- [x] Complete exact-head CI and review PR 5A before merge; M5/F08 now uses
      this merged Layer Editor without adding a second timeline or edit model.

## Implemented — M5 / F08 Reviewable Agent Editing (PR #31 / PR 5B)

Base: merged 5A `a33340c43d40f82825bc788e1c82625883e6acbb`. Scope and evidence:
[reviewable agent editing validation](docs/validation-agent-editing.md).

- [x] Reuse the existing revision-bound review lifecycle and `graphic.scene.upsert`
      typed command; preview, select proposal actions and explicitly accept.
- [x] Restrict operations to selected, unlocked layers; show IDs, before/after
      values and typed conflicts; preserve deterministic local commands.
- [x] Route optional provider calls through `ProviderRegistry` and explicit text
      consent; send only selected layer snapshots and no media paths/assets.
- [x] Disable preview during unsaved edits; make uncertain acceptance block
      composition mutations, navigation/flush and export. Preserve proposal
      order independently of action selection order.
- [x] Keep provider generation outside the mutation queue, propagate cancellation
      on owner change/close and enforce a bounded response deadline.
- [x] Preserve pending acceptance barriers across inspector unmounts; validate
      template provenance before exposing edits and mark required proposal
      actions so only valid explicit selections can be accepted.
- [x] Persist the idempotency receipt before sending acceptance; restore the
      project/Composition barrier across app reload and block keyboard history
      and direct direction acceptance while the result is uncertain.
- [x] Keep long local text instructions actionable with bounded review reasons.
- [x] Cover application, API, browser, undo/redo/reopen, stale/locked and actual
      synthetic MP4 regressions with existing project contracts.
- [x] Complete implementation-source CI and fresh review; record the exact source
      SHA, passing checks, docs-only CI runner blocker and remaining manual gates
      in the validation record.

## Implemented — M1 / F07 Visual QA

Scope and evidence: [creative-scene platform roadmap](docs/roadmap/creative-scene-platform.md)
and [Visual QA validation](docs/validation-visual-qa.md). F01–F13 are a newly
documented crosswalk; this is not a retroactive claim that those labels existed.

- [x] Render the saved Composition revision to a unique private project cache;
      verify synthetic MP4 frames, timestamps and source/output hashes.
- [x] Report typed missing/changed/unsupported media, font/glyph failures and
      measured title overflow; label suspected black/blank as manual review.
- [x] Share the application path across Desktop, HTTP and CLI; let keyboard
      users jump from a finding or contact-sheet frame to Edit time.
- [x] Cover stale revision, cancel/retry, project switching, cache isolation,
      non-mutating report polling and three-locale i18n.
- [x] Run the applicable local gate matrix and record exact outcomes in the
      [Visual QA validation record](docs/validation-visual-qa.md).
- [ ] Manual: private-film aesthetics, display/projector readability, long/4K
      performance and actual Resolve/NLE finishing remain separate gates.

## Creative Scene Platform — M1–M6 delivery queue

Scope and acceptance: [creative-scene platform roadmap](docs/roadmap/creative-scene-platform.md).
The F01–F13 labels are a planning crosswalk introduced by that roadmap; they do
not retroactively rename completed project capabilities.

- [x] **M1 / F07 — Visual QA and contact sheets.** A saved-revision implementation
      is merged with M2 in [PR #27](https://github.com/bynanci/open-film/pull/27);
      published-head CI and workstation gates are tracked separately.
- [x] **M2 / F04 — Native Caption Track.** Versioned Composition cues, transcript
      provenance, Edit lane/Inspector, MP4 burn-in and SRT/VTT output are implemented
      in [PR #26](https://github.com/bynanci/open-film/pull/26); CI and workstation
      gates are tracked separately. Shortening rejects before enqueueing when it
      would exclude a saved caption; users adjust affected cues explicitly.
- [x] **M3 / F01 — Declarative GraphicScene.** Strict Image/Text/Shape/Group scenes,
      explicit enter/exit animation, shared Monitor/MP4 raster and existing history
      are implemented; final PR gates and manual limits are tracked in the
      [validation record](docs/validation-graphic-scene.md). General clip keyframes
      from the earlier M3/F03 proposal remain deferred.
- [x] **M4 / F02 — Creative Story Templates.** Conversation Card, Route Story and
      Photo Relationship build on M3 GraphicScene v1; merged in [PR #29](https://github.com/bynanci/open-film/pull/29).
- [x] **M5 / F03 — Layer Editor (PR 5A).** Add scene-layer selection and direct
      position/size/rotation/opacity/z-order editing, hidden/locked state,
      snapping/guides and keyboard controls through existing typed commands;
      merged as PR #30.
- [x] **M5 / F08 — Reviewable Agent Editing (PR #31 / PR 5B).** Generate allowlisted typed
      proposals, explain affected IDs and before/after values, surface conflicts,
      and require Preview → Select → Explicit Accept; preserve local deterministic
      operations without a configured provider.
- [ ] **M6 / F05 + F06 + F10 + F13 — Photo/audio/output review.** Add decoded
      audio diagnostics and repeatable output evidence; keep hardware, real media,
      4K and NLE finishing as separately recorded manual gates.
  - [ ] D5A: add focal interaction, ambient fill and a separately versioned
        bounded custom-easing contract with legacy reopen and output parity.
  - [ ] D5B: add separately versioned bilingual runs and bounded title finishing
        with legacy reopen, missing-font evidence and output parity.
  - [ ] D7A: pin a licensed test font/tool record, centralize metric-specific
        tolerance policy and add deliberate failures plus focused OS evidence.

The candidate for each milestone requires its complete exact-head automated gate
before merge. Synthetic media proves bounded behavior only; it does not certify
private-film aesthetics, hardware, Resolve, 4K or physical display quality.

## Current — Apache-2.0 restoration

Policy: [licensing](docs/licensing.md) and
[ADR 010](docs/adr/010-apache-license-restoration.md).

- [x] Allow commercial use and proprietary derivatives under Apache-2.0 while
      retaining required notices, earlier Apache/GPL grants and third-party terms.
- [x] Keep the exact original Apache license, archive the preceding GPL text and
      align every first-party package, Rust declaration and original look recipe.
- [x] Verify current declarations and historical notices through regression tests;
      retain CC0 fixture grants and separate FFmpeg, font and dependency licenses.
      Six licensing cases and twelve recipe cases pass; published full-gate
      outcomes are recorded in the integrating PR's checks.

## Current — Photo pull-out preset follow-up

Contract: [photo-film quality](docs/photo-film-quality.md#photo-pull-out).

- [x] Let people choose a bounded pull-out movement on a still photo, including
      Original layout, without silently replacing its layout or static transform.
- [x] Preserve motion through validated commands, retry, Undo/Redo and reopen;
      retain text, soundtrack, timing and protected clips during regeneration.
      Focused application/solver regressions pass (101 tests in two files).
- [x] Verify shared preview/render endpoints and localized motion controls with
      generated output frames and the integrated 24-case browser regression.
- [ ] Manual: real display/camera quality and downstream NLE motion recreation
      remain workstation checks.

## Current — Native on-screen text control follow-up

Scope and development evidence: [native text controls](docs/native-text-controls.md).
Checked entries require implementation, relevant tests and UI validation.
Final full-gate and published exact-head results belong to the integrating PR;
see [combined evidence](docs/validation-quality-controls.md).

- [x] Let people fade native text and its scrim without fading the photo, video,
      transport or audio, with clip-local preview/render timing.
- [x] Keep native captions clear of the bottom edge using a measured,
      frame-relative safe distance with defaults that preserve older projects.
- [x] Offer local Regular/Bold text weight without silently replacing authored
      custom weights or changing older subtitle defaults.
- [x] Adjust native text size in composition pixels and restore only its role
      default while preserving the remaining style, history, audio and saved cut.
- [x] Preserve authored fade/margin through command validation, all lock sources,
      exact retry, Undo/Redo, replacement, trim/speed/split and saved reopening;
      focused application/solver regressions pass (88 tests in two files).
- [x] Verify localized controls, decoded output pixels and browser behavior;
      integrated focused browser and independent correctness reviews pass.
- [ ] Manual: native display/projector readability and actual NLE title finishing
      remain workstation gates; native text styling does not add SRT/VTT burn-in.

## Current — MP4 output quality

Scope: [output quality](docs/export-quality.md).
Evidence: [focused validation](docs/validation-export-quality.md).

- [x] Show the film's actual saved frame/fps and original-source policy rather
      than implying every existing project has a newly selected HD preset.
- [x] Choose validated Standard/High detail video compression as a transient
      preview/MP4 snapshot without changing source, music, frame or edit data.
- [x] Record actual encoder settings and verify generated x264 SEI, decoded audio,
      original hashes, HTTP/CLI guards and localized accessible component behavior.
- [x] Exercise combined controls in 24 browser cases, including four export
      locales and saved-data isolation; preserve the source/output distinction.
- [ ] Manual: judge private-film readability and camera/display/projection quality
      on intended hardware; installer and actual Resolve gates remain open.

Release gate: the integrating PR records the complete serial regression and
exact-head CI results. Merge requires green checks and no correctness blocker;
focused tests alone do not satisfy this gate.

## Implemented — Original film looks

Scope: [workflow and numerical contract](docs/film-looks.md).
Evidence: [validation](docs/validation-film-looks.md) and
[pinned open-source decisions](docs/film-look-open-source-reference.md).

- [x] Choose six original looks and strength without changing source files,
      timing, titles or audio; retain an explicit original-color option.
- [x] Save whole-film, scene and clip settings through shared validated commands,
      with inheritance, locks, Undo/Redo, idempotent retry and reopen coverage.
- [x] Preserve segmented looks or explicitly unify one preview/MP4, including
      protected clips, without changing saved settings or editable exports.
- [x] Compare actual source SVG screenshots with encoded SDR fixtures and record
      the bounded numerical/color contract, immutable recipes and provenance.
- [x] Expose localized controls in English, Traditional Chinese and Japanese,
      including pseudo-locale and three desktop-size browser coverage.
- [x] Preserve authored/effective look metadata in JSON/OTIO and report manual
      recreation; reject unsupported active-look FCPXML/EDL exports.
- [x] Integrate regression coverage and independent correctness/UX follow-up;
      174 files / 2,586 unit/integration tests and nine focused browser cases pass.
      Full browser and published exact-head outcomes remain tracked in PR checks.
- [x] Correct known Vue SSR dependency behavior, verify local API trust guards and
      reject non-self-contained media inputs while preserving supported formats.
      Record remaining native transitive notices in the [security review](docs/security-review-2026-10-18.md).
- [x] Record the earlier GPL-3.0-only distribution decision as historical, preserving
      its grants alongside Apache text/notices and fixture CC0 grants. The current
      Apache-2.0 restoration is tracked above and in [licensing](docs/licensing.md).
- [x] Refresh imported media even when a small import completes before its first
      jobs acknowledgement; reproduce the missed transition in unit/browser
      regressions while preserving project ownership and render-progress isolation.
- [x] Retry failed derived media reads independently of immediate Activity status,
      clear prior-project views, and wait for bounded initial loading without
      delaying terminal renders or adding source scans to import progress updates.
- [ ] Manual: assess real camera/HDR material and intended display appearance;
      native installers and actual Resolve finishing remain separate gates.
- [ ] Before Linux installer release: obtain a compatible upstream remedy for
      GLib's `RUSTSEC-2024-0429`, investigate transitive reachability and re-audit;
      track the unmaintained `proc-macro-error` dependency without hiding notices.

## Implemented slice — Reviewable scene directions to edits

Scope: [scene-direction editing](docs/scene-direction-editing.md).
Evidence: [validation record](docs/validation-scene-direction-editing.md).
This bounded offline compiler extends existing photo commands. It does not infer
arbitrary prose or image contents and never calls a language provider.

- [x] Turn supported saved scene phrases into explained photo-layout/motion
      actions, showing exact source evidence and explicit unsupported/conflict notes.
- [x] Preserve locks, required media, paired photos, manual presentation and all
      other scenes; keep film timing unchanged and enforce its configured maximum.
- [x] Preview each action without saving, select a safe subset and adopt it as
      one ordinary saved command batch with one-step Undo/Redo.
- [x] Bind reviews to current scene/assets/settings; reject stale or unsafe subsets
      and retain durable receipts for lost responses, reopening and fresh adoption
      after Undo without applying an old retry again.
- [x] Share preview/adoption through the application, HTTP and CLI; test moved
      managed media, external writers and publication/commit failures.
- [x] Integrate the existing Edit inspector in English, Traditional Chinese and
      Japanese with pseudo-locale, keyboard and bounded desktop layout coverage.
- [x] Fix reviewed prerequisite-preview, opaque CLI identity and source-lock
      regressions; prove selected recipe previews, valid photo/video edits and
      protected presentation/delete/replace behavior through focused tests.
- [x] Align Soundtrack, paired-photo and overlay-Precision controls with shared
      source-lock rules; retain paired identity, permitted ordinary Story edits,
      playback and analysis, with four failing-then-passing browser regressions.
- [x] Pass local non-browser gates and focused browser checks; include the new
      cases in existing full CI and independently review correctness. Full browser
      outcomes and exact-head merge readiness are tracked with the candidate PR.
- [ ] Manual: assess intended movement/layout on private films and workstation
      playback; Windows installer, camera hardware and Resolve gates remain separate.

The candidate starts from PR #19 head
`298077fdfe4937b0c9d9e11f272d409b18fb3960`, preserving its Windows recovery work.
It also fixes that base's FFmpeg 6 overlay-visibility regression, with the same
actual render tests on FFmpeg 6.1.3 and 7.1.5. This does not certify workstation QA.

## Implemented slice — Photo-film quality

Scope: [photo-film quality contract](docs/photo-film-quality.md).
Evidence: [actual generated A/B validation](docs/validation-photo-film-quality.md).
This is a rendering/editing slice over the existing project and composition
engine. Generated fixture success does not certify the supplied private film's
artistic quality or replace workstation gates.

- [x] Preserve old projects while adding validated, optional version-1 photo
      layouts, bounded motion, graphic title roles and audio automation.
- [x] Render manual focal/protected hero framing and explicit two-source diptychs
      through a shared frame-space plan; report safe fallback instead of hiding crop loss.
- [x] Render clip-local hold, push-in and pan with shared arbitrary-seek timing;
      keep the comparison's push-in/pan active and protected subjects visible.
- [x] Measure local CJK glyphs and line breaks and reuse the graphic-title raster
      for preview/render, with actual font identity in private output evidence.
- [x] Add imported music/narration on explicit overlay tracks through existing
      commands, without extending the film or rippling the visual story.
- [x] Render clip-local fades, gain envelopes and manual ducking; verify the
      actual exported synthetic audio instead of only testing filter strings.
- [x] Generate public CC0 calibration assets and two actual 20-second MP4s, with
      composition diff, 24 sampled frames each, source hashes, font/encoding
      manifests and FFprobe/loudness/true-peak/RMS evidence.
- [x] Pass corrected implementation `8baa274` local format/i18n/lint/types,
      158-file/2,273-test Vitest, build, official OTIO, real CJK built-CLI checks
      and 11/11 focused photo browser tests.
      Track its full browser/CI outcomes separately on PR #18 checks.
- [x] Fix independent Desktop review findings for motion-only preview, persisted
      diptych spacing and audio Undo/Redo playback, with focused browser regressions.
- [x] Address twelve unique follow-up P2 findings covering title bounds/defaults,
      overlay/audio compatibility, layer/source recovery, diptych validation and
      empty-track interchange; preserve source-replacement title style, visual
      overlay selection and recoverable historical typography. Independently
      review the corrected frozen source.
- [x] Re-run the A/B evidence against committed implementation
      `8baa2740eea22bcb2f33a29647839c12a7585b31` with a clean working tree,
      review the extracted frames and verify unchanged 20-second output/source hashes.
- [ ] Manual: judge real photo selection/layout, original speech/music and
      projection readability on intended playback hardware.
- [ ] Manual: real Windows/native installation, Pixel/Insta360 sources and
      Resolve import/finishing remain independent workstation gates.

Configured audio envelopes are clip-local. Moving source-in changes the content
under that envelope; shortening clamps its end to the remaining duration.
Splitting audio with active automation is rejected until envelope partitioning
is implemented. Complete local/remote regression evidence remains distinct from
the focused measurements above.
The initial `ae61376` implementation's 153-file/2,213-test and 116-pass browser
run plus one configured environment retry remain historical evidence in the
validation record. They do not describe the corrected head's full browser suite.
The preceding `025bead` implementation passed 119/119 browser tests in 16.4
minutes; that success precedes four further fixes and does not certify the
expanded current full browser suite.
Published-head browser/CI and merge readiness are tracked separately on
[PR #18 checks](https://github.com/bynanci/open-film/pull/18/checks); local results
do not substitute for those checks or workstation QA.

## Implemented slice — Reviewable scene-script suggestions

Scope: [scene-script review](docs/scene-script-review.md).
Evidence: [validation record](docs/validation-scene-script-review.md).
Base: main `b6225512b701f609170de57967c63fcaa344209f`, after PR #15 merged
with successful main CI. Real model quality and workstation observations remain
separate in [issue #7](https://github.com/bynanci/open-film/issues/7).

- [x] Let people review reasoned narration or visual-direction changes beside a
      saved Story scene, with explicit Accept/Skip and preserved original evidence.
- [x] Use the existing LanguageProvider registry and exact disclosed remote
      consent; allow text-only providers without sending source media or paths.
- [x] Preserve newer manual text, other script fields, timing, clips and existing
      films through stale output, concurrent work and rejected acceptance.
- [x] Preserve accepted text and its audit through file/DB failures, uncertain
      responses, retry, reopening and external project changes.
- [x] Share the workflow through Desktop, HTTP and CLI with bounded storage,
      transactional catalog migration, jobs, cancellation and owner recovery.
- [x] Cover three-language/pseudo layouts and keyboard controls with focused
      browser regressions; include them in existing CI and review the source.

Merge policy: require complete green CI for the exact published head, refresh
review/head/base and resolve correctness findings before merging. Targeted and
complete local results remain distinct in the validation record.

## Completed slice — Classified memories to scene scripts

Scope and acceptance: [scene-script planning](docs/scene-script-planning.md).
Evidence: [validation record](docs/validation-scene-script-planning.md).
The current slice starts from main `e2e926b23ac0fe3bb8aa1d474592a3aef80e6ae6`,
which includes merged PR #13; PR #14's isolated fixture repair is now merged in
main `61af41fbac17c32ffdc11679612636566bd73a1c`. The record separates passing
targeted tests, the initial full-browser failures and corrected 13-test UI run.
Published-head CI/review follows the merge policy below. Real workstation
evidence is tracked by [issue #7](https://github.com/bynanci/open-film/issues/7).

- [x] Let people classify memories in Library and review category/chronology-based
      scenes without claiming automatic understanding of photo contents.
- [x] Provide editable scene purpose, narration and visual direction in the film
      language; preserve custom text after save/reopen and UI language changes.
- [x] Preview the actual solver-generated cut against target/maximum durations,
      with valid cuts/crossfades and protected required/locked selections.
- [x] Accept a reviewed plan as one new Story/composition pair, reject stale
      inputs and preserve unrelated films through save failures and retry/reopen.
- [x] Share bounded planning and acceptance through Desktop, HTTP and CLI, with
      generated-media unit/integration/browser regressions, large valid plan
      payloads and protected controls during delayed acceptance.
- [x] Fix the observed boundary/review failures and preserve passing corrected
      UI regressions for pseudo-layout and concurrent typing during beat saves.

Merge policy: require complete green CI for the exact published head, refresh
its review/head/base and resolve correctness findings before merge. Current
results are recorded in [PR #15 checks](https://github.com/bynanci/open-film/pull/15/checks).

Narration synthesis, image interpretation and motion/keyframes are outside this
slice. Optional text-based script assistance is tracked in the current slice above.

## P0 — Foundation and media workflow

- [x] Let users cancel an unresponsive transcription provider, close/reopen and
      retry without losing saved recognition or allowing obsolete callbacks to
      change the cancelled Job or successor transcript. Held-provider application,
      HTTP and three-language browser regressions pass; full candidate gates and
      review are recorded in [the validation record](docs/validation-transcription-cancellation.md).
- [x] Preserve active transcription/waveform/scene analysis when another process
      opens the project; atomically reserve/consume work and fence obsolete
      progress/results. Exact-checkpoint recovery preserves manual recognition
      and edits; Activity/API/CLI share ownership-aware actions. Actual-child,
      transaction/HTTP/CLI and three-language browser regressions pass; see
      [the validation record](docs/validation-media-analysis-recovery.md).
- [x] Let an observer leave and reopen a film while another process continues
      analysis, without cancelling that work or losing edits. Local work,
      missing runtime evidence and in-flight Precision/Transcript mutations retain
      navigation barriers; 39 component regressions and the actual-child browser
      flow pass. Corrected-candidate gates remain separate from earlier CI.
- [x] Keep Undo/Redo from resetting a source while Precision requests are pending,
      and keep marker/analysis requests from starting during history changes.
      Fourteen additional actual-SFC regressions preserve normal one-step Undo;
      the corrected published candidate still requires complete gates and CI.
- [x] Keep selection decisions from disappearing while an earlier rating save
      awaits acknowledgement. Card/inspector controls show their pending state;
      six actual-template regressions and a real delayed-response Proposal
      workflow pass without weakening rejected/unsupported-media checks.

- [x] pnpm monorepo, strict TypeScript, lint/format/typecheck/test/build scripts.
- [x] Preserve the historical Apache-2.0 LICENSE/NOTICE and decision record; current derivative terms are in [licensing](docs/licensing.md).
- [x] CI workflow configured for TypeScript, media, interchange, browser, and
      native checks; execution results remain separate from configuration.
- [x] Portable media/project/story/composition/event/job models.
- [x] Versioned project schema, validation, and documented draft migration.
- [x] Source, metadata, analysis, scorer, template, solver, renderer, exporter,
      and AI provider interfaces; scoped remote-provider consent validation.
- [x] New/reopened `.openfilm` project directories and SQLite catalogs.
- [x] Local folder discovery and actual image/video/audio inspection.
- [x] Capture timestamp precedence, confidence, source, and timezone uncertainty.
- [x] System or bundled-Perl ExifTool with FFprobe/filesystem fallback.
- [x] Streaming source hashes; immutable originals in import/render tests.
- [x] Thumbnails and video proxies in project cache.
- [x] Bounded import concurrency, per-file failure isolation, durable progress,
      cancellation, unchanged-file skips, and interrupted-run recovery.
- [x] Exact and basic perceptual duplicate grouping.
- [x] Deterministic temporal/GPS/similarity event grouping.
- [x] Paginated chronological library, search/filter, rating, favorite, rejected,
      and locked state.

## P1 — Story, composition, and preview

- [x] Generic story creation and explainable offline asset scoring.
- [x] External Proposal Film template with a configurable emotional arc.
- [x] Desktop beat title/intent/target/selection editing.
- [x] Maximum duration, beat minimum/maximum, required inclusion/exclusion,
      locked media, chronological/explicit order, and no-repetition constraints.
- [x] Source-duration bounds and actionable composition failures.
- [x] Composition timeline model and desktop display.
- [x] FFmpeg preview with stills, video, audio, simple titles, basic transforms,
      speed/volume, and crossfade.
- [x] Preview playback and persistence across project reopening.
- [x] JSON, OTIO, FCPXML, and applicable EDL exporters with explicit unsupported-edit
      errors and timeline/source reference preservation.
- [x] End-user graphical trim, reframe, speed, volume, order, and transition editing.
- [ ] General event/person coverage and media-balance constraints.
- [x] NLE compatibility matrix distinguishing implemented, parser-validated and
      manually unverified behavior; actual Resolve import remains a manual gate.

## P2 — Delivery and ecosystem

- [x] CLI and loopback API sharing the application service.
- [x] Vue desktop workspace and Tauri folder picker/service-start contracts.
- [x] Generated public-domain sample media and domain/integration/browser suites.
- [x] README, contribution/conduct/security policies, architecture, format docs,
      changelog, roadmap, and ADRs.
- [ ] Self-contained native installer and multi-platform installation validation.
- [x] Native measurement tooling: opt-in UI/Edit clocks, generated 500-clip
      fixture, rooted process-memory series, preserved partial evidence and
      failure/cancellation/identity regressions; see [the procedure](docs/native-performance.md).
- [x] Reject unrelated/changed benchmark projects, media and undeclared SQLite WAL before starting measurement processes.
- [x] Keep repeated runs bound to the same immutable fixture using verified per-run project copies; preserve each run's edits and final hashes.
- [x] Prevent completion after an owned child exits during sampling, and preserve supervision/cleanup when evidence persistence fails.
- [x] Include Edit checkpoints delivered during the final sample in the terminal scenario report.
- [x] Fail finalization when an owned service survives its shutdown grace period, preserving active work and explicit remaining-process evidence.
- [x] Reject a successful benchmark when its service exits unexpectedly while waiting for normal native-window shutdown.
- [x] Reject provisional success after native nonzero exit or signal termination, retaining actual exit evidence and graceful service cleanup.
- [x] Request private IPC service shutdown, require project-close acknowledgement and normal exit, and preserve active work instead of forcibly terminating Windows services.
- [x] Bind benchmark evidence to both the selected Node launcher and the actual service runtime version/executable hash.
- [x] Finish the default fixture after a source reaches its hard-link limit, recording verified independent copies while preserving unexpected I/O failures.
- [x] Preserve failed reports, lifecycle evidence and graceful cleanup after asynchronous stdout/stderr errors; retain native exits that occur while output is pending.
- [x] Resume pending native UI/Edit readiness after restored visibility with two fresh frame opportunities, retaining original clocks and cancelling obsolete or unmounted views.
- [x] Record Compose-to-Edit entry through guarded navigation after the composition job finishes; preserve already-Edit remounts without duplicate entry intent.
- [x] Preserve acknowledged composition creation through later project/cache read failures, retaining other films and localized errors instead of encouraging duplicate creation.
- [x] Emit a provisional collection-stop event and publish terminal completion only after native exit, acknowledged service shutdown and final evidence persistence.
- [x] Replace published benchmark manifests through complete exclusive sibling writes and rename; failed updates retain the previous valid evidence.
- [x] Resume original-boot readiness after transient busy/error/loading states without replaying acknowledged checkpoints or reusing an obsolete project/view.
- [x] Verify actual BigInt filesystem link/copy identities during fixture preflight, rejecting changed topology and unavailable identity evidence.
- [x] Recheck Linux rooted process membership after memory reads; changed or unknown topology cannot produce a complete aggregate.
- [ ] Workstation native first-open repetitions and one-hour memory evidence.
      Requires real workstation execution; cloud compilation and process tests
      do not satisfy this gate.
- [x] Media relinking and logical-volume-aware library portability; native Windows
      remount checks remain manual.
- [ ] Plugin discovery/loading beyond built-in registration and SDK contracts.
- [x] Pixel and Insta360 adapters with metadata, safe previews and explicit raw
      source limitations; other camera-specific adapters remain future work.
- [ ] Local vision, embeddings and language implementations (local transcription is implemented in 0.3 P0).
- [ ] Incremental analysis/background worker scheduling at archive scale.
- [ ] Reproducible 10,000–100,000-asset performance benchmarks.

## Real editing workflow round

Checked items require working behavior, regression tests and relevant documentation.
Hardware and real NLE verification are recorded separately.

- [x] P0: story-first graphical timeline with trim, photo duration, drag/keyboard
      order, speed, volume, cut/crossfade, transform and explicit clip locks.
- [x] P0: scoped beat editing/regeneration, duration feedback and explainable fit.
- [x] P0: undo/redo, debounced durable autosave, recoverable errors and reopen tests.
- [x] P1: missing/offline state, single/folder relink and portable library references.
- [x] P2: Pixel metadata/HDR detection and experimental Motion Photo recognition.
- [x] P2: Insta360 exported media plus raw-source recognition/association.
- [x] P3: generated Proposal reference dataset, documented workflow and full E2E.
- [x] P4: Resolve fixtures, official OTIO validation and honest compatibility matrix.
- [x] P5: all local regression gates, including a 500-clip browser playback check.
- [x] P5: branch CI green; source/media/browser/interchange and native jobs pass.
- [x] Review regressions: import-scoped Insta360 directory indexes, accepted image
      and audio previews, current-state Fit savings, and paged media status beyond
      2,000 assets. Covered by unit, media/HTTP integration and browser tests.
- [ ] Manual: actual DaVinci Resolve import. The 2026-10-06 application preflight
      is blocked: this cloud environment has no Resolve, exposed GPU or desktop.
      A Resolve-capable workstation is required; see [the QA record](docs/resolve-qa-record.md).
- [ ] Manual: representative Pixel HDR/Motion Photo and Insta360 raw camera files.

Keep this file current when a pending capability gains working behavior and
validation; keep host-dependent checks distinct from source implementation.
Use [the workstation QA evidence contract](docs/workstation-qa.md) for Resolve,
ASR/LLM, GPU, camera, 4K, Windows installer and cross-process recovery gates.

## Global product experience and i18n round

Evidence: [validation record](docs/validation-global-product.md).

- [x] Previous correctness reviews fixed, tested and merged in PR #1; main CI green.
- [x] Resolve QA truth recorded; actual application import remains the manual gate.
- [x] Vue I18n en-US/zh-TW/ja-JP foundation, runtime locale preference, Intl formats,
      development pseudo locale and semantic key/placeholder coverage gate.
- [x] Separate persisted film locale/settings and template/user text ownership;
      legacy preservation, undo/redo and real HTTP save/reopen regressions.
- [x] Structured localized errors and complete Welcome/Create Film product flow.
- [x] Guided navigation, Library, Story, Edit, Export and missing-media recovery.
- [x] Keyboard/accessibility, CJK/pseudo screenshots and desktop layout QA.
- [x] Localized full workflow and existing regression coverage, including real MP4,
      pathless creation, Story save races and managed-thumbnail recovery.
- [x] CI integrates i18n coverage, locale workflows, visual/axe checks and local CJK
      fonts; the PR checks record the exact commit's execution result.
- [x] PR #2 review regressions: generic orientation/capture time, still rotation,
      managed-upload cleanup, read-only recent catalog/WAL validation, Missing
      refresh/pagination and bounded Story/Compose hydration. Legacy locale
      fallback confirmed; delayed asset reads preserve acknowledged edits.

## Impeccable UI refinement and Resolve QA handoff

Evidence: [validation record](docs/validation-impeccable-resolve.md).

- [x] Apply pinned Impeccable Operate/Polish guidance to existing UI: compact
      navigation, fixed-rem type, direct Welcome actions and media-first spacing.
- [x] Bounded Edit workspace: independently scrolling story rail/inspector,
      visible player and keyboard clip reveal without page scrolling.
- [x] Download editable exports, localized Resolve handoff and progressive
      capability disclosure in en-US, zh-TW and ja-JP.
- [x] Portable Resolve QA preparation and evidence helper, non-destructive
      project guards, 18 offline regressions and actual relocation/source checks.
- [x] CI builds and uploads the generated CC0 reference for workstation testing;
      includes source SHA/CI provenance and manual/API procedures.
- [ ] Actual Resolve import/playback/relink/effect QA on a capable workstation.
      The helper and official parser do not close this application gate.

## OpenFilm 0.3 — Media Intelligence & Precision Editing

First PR: P0 foundation. Evidence: [validation record](docs/validation-media-intelligence.md).
Checked implementation and automatic tests are separate
from model, camera and hardware certification.

- [x] Optional local TranscriptionProvider, word timestamps, Auto/zh/en/ja and GPU→CPU fallback.
- [x] SQLite v1→v2 migration, paged transcript revisions and successful-only re-transcription.
- [x] Shared durable analysis jobs, progress, cancellation and structured localized errors.
- [x] Source-bound bounded waveform, cache and FFmpeg scene markers.
- [x] Generic markers and portable snapping with priorities, thresholds and disabled sources.
- [x] Precision source player, waveform seek/hover/zoom/trim, marker and word/segment seeking.
- [x] Shared split/trim commands, lock protection, undo/redo, autosave and save/reopen.
- [x] English, Traditional Chinese and Japanese UX; desktop layout and keyboard regressions.
- [x] CLI/API/plugin reuse, reference/adaptation record and capability/setup documentation.
- [x] Full local regression gates and new CI regression coverage; candidate checks record the exact SHA.
- [x] Correctness review regressions: retimed crossfade split, project job readiness,
      dense marker paging, missing duration, provider callback lifecycle,
      language capabilities and consent/descriptor-aware availability.
- [ ] Manual: real model CPU transcription quality; model download currently proxy HTTP 403.
- [ ] Manual: GPU performance, real microphone/camera audio, large 4K and Windows installer.
- [ ] Manual: real DaVinci Resolve import on a workstation (existing gate remains open).

Vision, Highlights and caption tracks/burn-in remain deferred. Geometry, transcript
productivity and the scoped subtitle-export workflow are tracked separately below;
interface-only work is not completion.

## OpenFilm 0.3.1 — Transcript Productivity & Reviewable Intelligence

Evidence: [validation record](docs/validation-transcript-productivity.md).

- [x] Let people correct, split, merge and delete transcript text without changing media or the film.
- [x] Preserve provider evidence and manual revisions without silently claiming stale word timing is precise.
- [x] Search and replace occurrences, including one-step Undo/Redo for Replace All.
- [x] Recover autosaved edits after restart without duplicate requests or overwriting newer revisions.
- [x] Remember exact preferred terms globally or with the portable project, with project precedence.
- [x] Find glossary corrections offline and review, preview, accept or skip durable suggestions.
- [x] Offer optional bounded LanguageProvider review with consent, streaming evidence, cancellation and retry.
- [x] Reject stale or invalid suggestions and atomically preserve accepted correction audit evidence.
- [x] Share transcript/terminology/review commands across Desktop, API and CLI.
- [x] Verify localized, accessible Transcript UX and preserve Precision/Story behavior.
- [x] Pass complete local regression gates and address reproduced correctness review findings.
- [x] Preserve global terms across competing processes; recover interrupted/failed review batches with offline Retry/Skip.
- [x] Keep delayed transcription in its owning project and preserve valid multiline terms without invalid provider hints.
- [x] Keep earlier unfinished review recovery reachable after starting a new review; bound complete provider prompts without truncating evidence.
- [x] Preserve existing opaque segment IDs through search, keyboard edits and reopen; allow reviewable, undoable empty-term removal.
- [x] Preserve disabled terminology when saving edits and release missing-suggestion recovery without discarding uncertain requests.
- [x] Refresh short transcriptions without losing restored drafts; discard obsolete reconciliation reads and retain idempotent save retry.
- [x] Keep suggestion polling bounded on large transcripts while retaining source validation and stale-revision protection.
- [x] Return shrinking transcripts to a valid page across edits, history, recovery and revision restore.
- [x] Offer Remember only for the selected segment's current correction; reverted text cannot create a stale glossary rule.
- [x] Preserve opaque segment IDs with exact JSON transport and transactional v4 indexing without losing legacy evidence.
- [x] Read reserved asset IDs through canonical transcript CLI grammar while retaining existing actions.
- [x] Wait for owned transcript reads before navigation; retain startup recovery bytes through disposal and exact receipt retry.
- [x] Match Unicode case variants consistently across glossary and transcript search without changing original text offsets or expanding characters.
- [x] Reserve review acceptance before waiting for saves so rapid clicks cannot strand recovery receipts.
- [x] Validate maximum-size review selections with linear work while preserving exact IDs and privacy checks.
- [x] Save transcript drafts before batch retry without rebasing immutable review evidence.
- [x] Share the project-owned jobs snapshot instead of polling full history separately from each editor.
- [x] Search canonical legacy text across NUL and surrogate boundaries without losing offsets or inventing replacement-character matches.
- [x] Preserve full multiline glossary terms and valid long remembered corrections through review and reopen.
- [x] Return editable revision tokens from both CLI transcript read forms while preserving intelligence fields.
- [x] Reserve Undo, Redo and revision restore before pending saves so competing actions cannot replace an exact recovery receipt.
- [x] Wrap Next/Previous through the complete paged transcript search result set.
- [x] Allow leaving an initially failed clean transcript read while retaining all recovery drafts and uncertain receipts.
- [x] Keep providers without prompt hints independent of optional glossary storage failures.
- [x] Preserve the user's chosen search occurrence through explicit refresh and delayed timers so Replace Current cannot silently target another match.
- [x] Reject oversized Replace All expansion before allocation and keep merged text within the editable limit.
- [x] Preserve accepted suggestion audit state when another process concurrently skips it.
- [x] Preserve valid opaque language provider identities throughout review evidence and reopen.
- [x] Recognize confirmed preview/export cancellation through overlapping Job reads and keep late replies owned by their original project and Job.
- [x] Reserve confirmed transcript draft Discard through an in-flight save and saved-page reload, blocking competing edits and waiting navigation.
- [x] Filter the current transcript page literally without changing the global search occurrence cursor.
- [x] Bind remote review consent to the configured provider identity, displayed destination and all declared data kinds while sending only bounded text and terminology.
- [x] Claim a retry batch and its job owner atomically before preparation, with exact rollback and protection from obsolete attempts.
- [x] Recover review work automatically only for proven-dead owners; preserve live, unknown, foreign and legacy ownership with conservative platform handling.
- [x] Provide exact-checkpoint, user-confirmed manual recovery for unknown review owners without claiming Windows/macOS automatic liveness proof.
- [x] Prevent recovered glossary/language owners from publishing initial pending work; initialize complete batches atomically and retain existing evidence.
- [x] Verify Desktop recovery confirmation, cancellation, retry, skip and reopen preserve completed evidence and isolated film edits in a real browser.
- [ ] Automatic Windows/macOS cross-process dead-owner recovery with verified OS-specific process identity/liveness evidence.
- [ ] Manual: real speech/model quality, GPU/camera/large-source performance and Windows installation.
- [ ] Manual: actual Resolve QA remains a separate workstation gate.

## OpenFilm 0.3.2 — Shared Geometry Contract & Preview/Renderer Parity

Evidence: [validation record](docs/validation-geometry-parity.md).

- [x] Share validated frame-space contain-fit, scale, clockwise rotation and position across preview and renderer.
- [x] Keep source and composition-frame boxes separate, clip transformed media at the frame, and preserve alpha above lower visual tracks.
- [x] Normalize non-square-pixel display aspect before rendering without distorting source media.
- [x] Observe asynchronously loaded source viewports through inspector changes and mode replacement; retain valid preview during numeric edits.
- [x] Pass complete local regression gates and scoped review with actual FFmpeg and browser regressions.
- [ ] Manual: real camera/proxy/color behavior and actual NLE import remain workstation checks.

## Performance & Interaction Refinement

Evidence: [measurement and validation record](docs/performance-interaction.md).

- [x] Establish repeatable synthetic UI baselines before changing rendering behavior.
- [x] Keep unopened timelines out of Library rendering while preserving existing draft recovery and mounted editing history.
- [x] Keep source picker inputs stable across unrelated Activity updates.
- [x] Avoid rebuilding read-only transcript words on waveform hover; preserve timing, seeking, edited alignment and language switching.
- [x] Make keyboard focus distinguishable on selected and locked clips without moving them.
- [x] Verify delayed recovery cannot bypass navigation, discard original recovery bytes, or overwrite a replacement editor's draft after disposal.
- [x] Complete final candidate regression, multi-language visual/a11y checks and comparable measurements; record remaining narrow-window density and workstation limitations.
- [x] Limit 500-clip selection rendering to the old/new clip while preserving source/status/locale updates, drag validation, history and recovery.
- [x] Compare three baseline/candidate repetitions, expose first-mount cost and preserve real relink/Precision presentation with full regression coverage.
- [ ] Manual: real-media/4K/GPU/native-window performance remains a workstation check.

## Monitor stability and frame-accurate preview

Evidence: [validation record](docs/validation-monitor-stability.md).

- [x] Keep rendered overlays on integer output pixels and clip starts on output-frame ticks; cover odd offsets with decoded FFmpeg frames.
- [x] Publish bounded, monotonic FFmpeg render progress without catalog/project reloads on every poll.
- [x] Keep monitor sizing stable and expose preview-only composition guides, aspect presets, frame transport and loop controls.
- [x] Route quick 90-degree rotation and transform reset through the existing composition command/history path.
- [x] Verify real browser interactions and a 500-clip monitor layout; retain responsive sizing and composition persistence.
- [ ] Manual: verify physical monitor presentation and resize behavior on native Windows/macOS workstations.

## Composition-aware subtitle handoff

Scope and acceptance: [workflow contract](docs/composition-captions.md).
Reference evidence and candidate priorities: [OpenCut gap matrix](docs/opencut-reference.md).

- [x] Let people hand off corrected speech as film-timed SRT/WebVTT without re-transcription or timeline mutation.
- [x] Explain omitted boundary text, stale alignment, missing speech and overlaps before export.
- [x] Bind previews and output receipts to source/transcript/composition revisions; reject stale publication.
- [x] Share the validated flow across Export, HTTP and CLI with atomic output and project-scoped recovery.
- [x] Validate actual downloaded files with independent parsers and localized, bounded browser screens.
- [ ] Manual: subtitle playback in a real NLE/player remains separate from format-parser validation.

_Modified by OpenFilm contributors on 2026-10-18. Current OpenFilm first-party material is Apache-2.0; historical grants remain available. See LICENSE and NOTICE._

## Implemented — M7A / F09 Named Versions

PR #34 is merged at `bb2c4521ad894478893485119442a00ffd9b34cc`.
[Contract](docs/named-versions.md) · [validation](docs/validation-named-versions.md).

- [x] Immutable private manifest/SQLite snapshots, stable IDs, source receipts,
      idempotent requests, mutable labels and cross-session comparison/restore.
- [x] Explicit checkpointed restore with revision/source/lock fences and recovery.
- [x] Confirmed snapshot deletion through shared service/API/CLI/Desktop; bounded
      storage, receipt tombstones and journal-protected recovery checkpoints.
- [x] Collision-free ordered diffs and linear source-manifest validation.
- [ ] Manual: Windows/macOS filesystem, permissions and forced-exit recovery.

## Integrated — M7B / F10 Professional Export (#36)

[Contract](docs/export-profiles.md) · [validation](docs/validation-export-profiles.md).

- [x] Render-only 16:9, 9:16 and 1:1 profiles; actual MP4, PNG, WAV and role stems.
- [x] Preview-bound crop confirmation, selected look/caption/quality identity,
      complete-frame time bounds, private bounded cache and stale/cancel handling.
- [x] Uniform stereo stems, role-specific preflight and conflicting-source rejection;
      preserve original Composition, source hashes and audio curves.
- [x] Shared Application/Desktop/HTTP/CLI and real 12-second/three-ratio evidence.
- [ ] Manual: real-photo framing, target-player/NLE and sustained 4K validation.

## Integrated — M7C / F11 NLE Fidelity (#39)

[Contract](docs/nle-handoff.md) · [validation](docs/validation-nle-handoff.md).

- [x] Versioned native/metadata/baked/unsupported reports bound to saved source
      identity, options, rational frame boundaries and explicit acceptance.
- [x] Private portable TAR, native cuts/dialogue, scoped opaque precomps, optional
      full mix/caption sidecars and actual decoded frame/sample/hash evidence.
- [x] Verify all 22 review threads; retain already-correct cancellation and source fences.
- [ ] Manual: real Resolve/NLE import, relink, playback, color and channel checks.
- [ ] Future: transparent overlays and separately editable baked effects/stems.

## Integrated — M7D / F12 Collect Media (#37)

[Contract](docs/collect-media.md) · [validation](docs/validation-collect-media.md).

- [x] Plan only referenced Story/Composition media and font dependencies, with
      explicit rights, immutable source receipts and revision-bound publication.
- [x] Safe ZIP/directory paths, SQLite-consistent filtered catalog, no credentials,
      full reference/font validation and stable original provenance after relocation.
- [x] Verify exact dimensions and embedded audio, cancel both hash scans, reopen
      and compare actual MP4 after original sources are removed.
- [ ] Manual: target-workstation filesystems, typography/licensing and cross-machine QA.

## Partial — M7E / F13 Native Installer tooling (#38)

[Contract](docs/native-installer.md) · [validation](docs/validation-native-installer.md).

- [x] Hash-verified runtime staging, version agreement, private owned-service
      startup/shutdown, flush/close handshake, recovery remount and diagnostics.
- [x] Signed-manifest bytes pinned during verification; permission-preserving
      runtime/installer archives; portable Node/Vite build invocation.
- [x] Manual candidate workflow; bundling disabled by default, no automatic-update feed.
- [ ] Complete audited per-platform runtime inputs and license/dependency review.
- [ ] Obtain Windows/macOS clean-machine installer, first-run, signing/notarization,
      update and rollback evidence before distributing native installers.

## Integrated — M8A local PhotoDepth (#35)

[Contract](docs/photo-depth.md) · [validation](docs/validation-photo-depth.md).

- [x] Versioned local original/mask/fill/protected-subject recipe on GraphicScene;
      bounded parallax/easing, fallback and shared arbitrary-seek Monitor/FFmpeg.
- [x] Typed edits, locks, required selection, Undo/Redo, autosave, reopen and
      Named Versions remain on the existing Composition/history path.
- [x] Preserve source alpha when masking; typed stale-fallback QA; actual 6-second/
      180-frame source-hash/seek/edge/parity evidence.
- [ ] Manual: real protected subjects, edge aesthetics, physical color and sustained 4K.

## Integrated — M8B reviewable Motion Candidates (#40)

[Contract](docs/motion-candidates.md) · [validation](docs/validation-motion-candidates.md).

- [x] Local camera fixture and explicitly imported video candidates, declared
      provenance/cost/consent, compare, human review, explicit Accept/Replace/Restore.
- [x] Existing typed commands/history; narration/duration/source protection,
      stale/cancel/retry and prepared-journal/lost-response recovery.
- [x] Actual synthetic MP4/seeks/source receipts; private expiry/discard, including
      aged receiptless crash folders while preserving recent/prepared/imported work.
- [ ] Remote image-to-video remains disabled; future adapters require verified API,
      terms/license/cost/retention/download safety and explicit provider consent.
- [ ] Manual: human/detail fidelity, physical color and native presentation.

## Delivered — M9A Story Graph & Multi-Perspective Workspace

[Contract](docs/CONTRACTS.md#m9a-story-graph--multi-perspective-workspace) · [validation](docs/validation-story-graph.md).

- [x] Story and StoryBeat remain canonical; graph nodes reference stable `storyId` and `beatId` without duplicating content into divergent schemas.
- [x] Four node types (`theme`, `beat`, `asset`, `idea`) and four idea sources (`user-memory`, `planned`, `wish`, `unknown`).
- [x] Five edge types (`contains`, `supports`, `precedes`, `echoes`, `alternative`); cycle detection for `contains` and `precedes`; `echoes` strictly non-execution.
- [x] Playback order driven by explicit reorder operations, never inferred from node coordinates (x, y).
- [x] `GraphViewState` (pan, zoom, node coordinates) separated from video content revision (0 render/provider calls during canvas layout).
- [x] Multi-perspective Story workspace: Outline (`outline`), Story Graph (`graph`), and Storyboard (`storyboard`).
- [x] 3-column UI: Assets palette, Center Canvas, Inspector; auto-initializes graph on opening existing story (no empty canvas).
- [x] Search, fit-to-content, layered auto-layout, layout undo, and quick actions ("Add asset", "Create echo", "Set as next beat").
- [x] Compatible `@`-mentions with stable asset references (no private local file paths).
- [x] View switching preserves active beat selection; clip mapping pills indicate timeline placement.
- [x] Removing graph nodes/edges never deletes original library assets.
- [x] Comprehensive test suites (33 tests across core, story, application, and UI) including 100/500-node synthetic benchmarks (<50ms).
- [ ] Manual workstation testing: touch/pen gestures, large high-DPI displays.

## Delivered — M9B Graph to Reviewable Storyboard

[Contract](docs/CONTRACTS.md#m9b-graph-to-reviewable-storyboard-storyplan) · [validation](docs/validation-story-plan.md).

- [x] `StoryPlan` v1 schema and proposal engine: input signature binding, 5 storyboard dimensions, deterministic hex digest.
- [x] 5 reviewable card dimensions: which image/clip (hero/supporting/echo & PhotoDepth status), intent, visual direction, target & estimated narration duration (CJK/Latin pacing, no microsecond fake precision), editorial rationale (no fake scores).
- [x] Solver extension: `allowEchoAssetIds` enabling distinct opening & closing echo clip instances referencing the same asset ID without fabricating fake assets or globally disabling deduplication.
- [x] Narrative protections: reject canvas coordinate guessing, detect and surface cycles/unresolved alternative conflicts (HTTP 409), preserve source natures (`user-memory`, `planned`, `wish`, `unknown`), list `unsupportedIntents` explicitly, provide PhotoDepth fallbacks (`standard-hold`, `ken-burns`).
- [x] Preview & adoption: ephemeral preview composition with 0 project mutations and 0 provider calls; explicit adoption creates a new rough cut `(Story Plan Cut)` scoped to candidate assets while preserving original manual edits.
- [x] Idempotency: lost-response retry with identical `planId` and signature returns existing rough cut without duplicate compositions; stale signature rejected with HTTP 409.
- [x] Storyboard Review Modal with full i18n (`en-US`, `zh-TW`, `ja-JP`), source badges, conflict alerts, and rough cut creation.
- [x] Automated acceptance verification: 30.0s / 30fps (900 frames) rough cut with synthetic photos, fictional memories, echo clips, reopen, and manual edit preservation.
- [ ] Manual workstation validation: voice narration recording, production multi-track audio listening QA.

## Delivered — M10A Guided Pipeline Orchestration

[Contract](docs/CONTRACTS.md#m10a-guided-pipeline-orchestration) · [validation](docs/validation-pipeline-orchestration.md).

- [x] Canonical recipe (`guided-story-to-video`): 8 whitelisted steps (`story-plan-select` -> `scene-prepare` -> `narration` -> `timing-captions` -> `composition-adopt` -> `render` -> `visual-qa` -> `export`).
- [x] Recipe schema validation (`validatePipelineRecipe`): strict whitelist, typed ports (`story-reference`, `story-plan`, etc.), and DAG topological acyclicity validation (`checkRecipeAcyclic`).
- [x] Immutable input snapshot (`PipelineInputSnapshot`): deterministic 64-character lowercase hex digest calculation (`computeInputSnapshotDigest`).
- [x] Separation of execution lifecycle (`status`) and applicability (`freshness`): external edits correctly flag prior runs as `outdated` via `isRunOutdated` without rewriting history.
- [x] Legal adoption receipts (`PipelineRunReceipt`): atomically advance `expectedRevision` to match adopted project state, preventing self-invalidation.
- [x] Heavy media serialization: dedicated concurrency = 1 lock (`heavyLock`) for heavy media rendering and solver operations.
- [x] Tone mock guard: rejects synthetic tones (`local-audio-mock`) from speech narration with an actionable error explaining tone mock cannot masquerade as speech.
- [x] Remote motion transparency: unconfigured remote motion is explicitly flagged as `unavailable` rather than synthesizing fake progress.
- [x] Zero-lock review gates: `waiting-review` steps release all locks and background subprocesses; polling `getRun` is strictly read-only.
- [x] Cancellation & late result protection: `cancelRun` broadcasts `AbortSignal` and late subprocess results are discarded.
- [x] Reopen persistence: durable run storage in `cache/pipeline-runs.json`; application reopen restores runs without killing live processes.
- [x] Retry vs new run: `retryRun` retains identical input snapshot and increments attempt count; `createRun` captures current project revision.
- [x] Idempotency: repeated execution of succeeded runs returns immediately without side effects.
- [x] Desktop UI integration: `PipelineOrchestrationModal.vue` with preflight checklist, stepper track, status chips, waiting review action cards, artifacts list, outdated alert, full i18n (`en-US`, `zh-TW`, `ja-JP`), reduced motion, and 1024x768 responsiveness; triggered via header and story toolbar.
- [x] Verification: comprehensive unit and application integration test suites (20 tests across core, application, and UI).
- [ ] Manual workstation validation: end-to-end hardware-accelerated video export, high-DPI display layout review.

## Delivered — M10B Pipeline Workbench UI/UX

[Contract](docs/CONTRACTS.md#m10b-pipeline-workbench-uiux) · [validation](docs/validation-pipeline-workbench.md).

- [x] Information architecture: preserved Library/Story/Edit/Export; docked collapsed status bar (`bar`) above footer, expandable drawer (`drawer`) preserving creative context, and focused fullscreen view (`modal`).
- [x] Simplified 5 stages: Materials (`materials`) -> Story Plan (`storyPlan`) -> Produce Clips (`produceClips`) -> Preview & QA (`previewQa`) -> Export (`export`).
- [x] Four Questions per card: explicit answer to Used What (`usedWhat`), Produced What (`producedWhat`), Current Status (`currentStatus`), and Next Action (`nextAction`).
- [x] Media safeguards: static photo thumbnails (`thumbnailUrl`), inline audio audition mini player with play/pause, and click-to-play video preview (unselected cards never auto-play).
- [x] Status-dependent CTAs: supplement missing audio, review & confirm, adopt rough cut, retry step, export film.
- [x] Outdated draft transparency: `isRunOutdated` flags runs based on older drafts with a prominent amber alert banner and "Create New Run with Latest Draft" CTA.
- [x] Non-blocking waiting review: displays clear action prompts without continuous infinite spinners.
- [x] Indeterminate progress: in-progress steps with dynamic durations use indeterminate spinners rather than faking average percentages.
- [x] Actionable error diagnostics: step identification, failure cause, and concrete recovery action.
- [x] Cross-view navigation: `[Locate in Story Graph]`, `[Locate in Storyboard]`, `[Locate on Timeline]` with selection and viewport preservation upon return.
- [x] Form & polling safety: background polling updates reactive run state without remounting editors or wiping uncommitted form inputs.
- [x] Responsive layout: 1440x900 3-pane workbench, 1280x720 2-pane collapsible, 1024x768 single-pane stacked drawer.
- [x] Keyboard & IME protection: input/textarea key events isolated from global hotkeys; 1..5 shortcuts for stage navigation; Esc collapses drawer/modal.
- [x] Disclosures & consent: external TTS service disclosure (data category, destination, cost, and explicit consent checkbox); M11A cache disclosure.
- [x] Real services acceptance: verified missing audio supplement journey, review & adopt journey, failure recovery journey, and outdated draft detection journey.
- [ ] Manual workstation validation: live multi-track audio listening QA, high-DPI touch/gesture workbench verification.

## Delivered — M11A Change Impact and Incremental Runs

[Contract](docs/CONTRACTS.md#m11a-change-impact-and-incremental-runs) · [validation](docs/validation-change-impact.md).

- [x] Separation of concerns: composition revision used strictly for checking adoption permissions and draft freshness; per-step consumed-input signatures (`computeStepConsumedSignature`) govern artifact reusability. Project-wide revision bumps do not invalidate unaffected steps wholesale.
- [x] Canonical step consumed signatures: canonicalized key-sorted deterministic hashing via 64-char FNV-1a mixer (`fnv1a64Mix`). Stamped onto `PipelineStepAttempt.inputSignature` and `PipelineArtifactRecord.inputSignature`.
- [x] Impact Matrix: Case 1 (canvas pan/zoom/fold) and Case 2 (unconsumed draft notes/ideas) yield 0 media calls and 100% artifact reuse.
- [x] Impact Matrix: Case 3 (subtitle text/style modified) yields 0 TTS calls, 0 motion calls, downstream visual QA / export rerun, and verified A/B output bytes reflecting updated subtitles.
- [x] Impact Matrix: Case 4 (narration script modified) reruns voice audio and downstream steps while preserving visual assets and scene prep.
- [x] Impact Matrix: Case 5 (photos changed / PhotoDepth changed) reruns visual preparation while preserving voice narration audio (0 TTS calls).
- [x] Impact Matrix: Case 6 (output aspect ratio changed) reruns delivery framing, rendering, and QA while preserving audio tracks.
- [x] Impact Matrix: Case 7 (source media bytes, font, or adapter version changed) cleanly propagates invalidation to all genuine consumers.
- [x] Impact Matrix: Case 8 (external service consent revoked) re-checks permissions; cache hits cannot authorize remote dispatches or bypass user consent.
- [x] Verified artifact reuse before hit: `verifyArtifactForReuse` strictly verifies input signature equality, physical file existence on disk, non-zero file size, byte size matching against recorded metadata (tampering check), referenced asset presence in catalog, adapter version match, and active user consent.
- [x] Full-render fallback transparency: `renderMode: "full-render-fallback"` explicitly reported when rasterization or subtitle changes require re-rendering. No claim of in-place MP4 frame patching.
- [x] Immutable history & stale rejection: user confirmation creates a brand new `PipelineRun` with a fresh `runId` and updated `inputSnapshot`; previous runs and receipts remain untouched. Stale impact reports are rejected if project revision advances prior to confirmation.
- [x] Reused attempt provenance: reused step attempts stamped with `status: "succeeded"`, their verified `inputSignature`, and metadata `reuseSource: { runId, stepId, reason }`.
- [x] Asset protection: `isAssetReferencedByPipeline` checks all snapshots, attempts, and artifacts to prevent media referenced by pipeline runs from being deleted or pruned.
- [x] Workbench UI integration: docked bar displays `[View Change Impact]` CTA when outdated; opens modal displaying per-step badges (`reuse`, `rerun`, `needs-review`, `unavailable`), human-readable explanations, changed input tags, full-render fallback notice, and "Start Incremental Run" CTA.
- [x] Verification: comprehensive unit and integration test suites covering all 8 matrix cases, disk tampering detection, stale report rejection, base run immutability, zero service calls on reuse, and full i18n compilation across `en-US`, `zh-TW`, and `ja-JP`.
- [ ] Manual workstation validation: live multi-track audio listening QA, external remote TTS latency verification.

## Delivered — M11B Creative Variants and A/B Review

[Contract](docs/CONTRACTS.md#m11b-creative-variants-and-ab-review) · [validation](docs/validation-creative-variants.md).

- [x] Three distinct versioning concepts: clear separation between full immutable project snapshots (`ProjectVersionRecord`), ephemeral session undo/redo, and structured branching records (`CreativeVariant`) in `cache/creative-variants.json`. No duplication of raw media and no secondary database.
- [x] Section isolation proof ("只改本段"): creating a variant with `scope: "section"` provably leaves 100% of non-target beats and clips unchanged (`preservedSections`), preserving exact media asset ID, filters, transforms, and timing relative to preceding cursor offsets.
- [x] Edit lock preservation: `clip.locked` is strictly preserved on cloned variant clips. Modifying a section containing locked clips without prior unlocking fails closed with HTTP 409 (`timeline.conflict`).
- [x] Zero-render A/B comparison: `compareVariants` inspects existing composition models, story structures, and pre-existing pipeline preview/QA artifacts without triggering media rendering, re-rasterization, or external service calls ("開比較不重新生成").
- [x] Single-audio playback safety: player and modal enforce that only one variant audio channel plays at any time. Selecting Audio A mutes/pauses Audio B; selecting Audio B mutes/pauses Audio A (`activeAudioChannel === "A" | "B"`).
- [x] Section-based alignment navigation: differing overall runtimes navigate by section/beat markers; never falsely claim differing runtimes align at identical absolute timestamps.
- [x] Mandatory pre-adoption checkpoint: `adoptVariant` verifies source availability, edit locks, and expected revision before mutating the active project. A named checkpoint version (`app.versions.create`) is created automatically before promoting the variant composition to `timelines[0]`. Checkpoint failure immediately aborts adoption without project mutation.
- [x] Post-restore invalidation: restoring a baseline checkpoint (`app.versions.restore`) reverts project state; old pipeline runs, approval receipts, and adopted variant references targeting superseded revisions are marked `outdated` via `isRunOutdated` and cannot be re-adopted.
- [x] Shared media protection: deleting a creative variant deletes only its derived Story, derived Composition, and variant record. Shared catalog `MediaAsset`s are never deleted or pruned.
- [x] Collect Media privacy: collecting media for a variant with `scope: "current-film"` packages only the media assets directly referenced by that specific composition, strictly excluding private assets from other variants or unconsumed library media.
- [x] UI/UX Workbench Integration: `CreativeVariantComparisonModal.vue` with 3 views (`list`, `create`, `compare`), live change impact preview, locked warnings, A/B video player, diff summary table, automatic checkpoint notice, keyboard/IME protection, responsive layout (1440x900, 1280x720, 1024x768), reduced motion support, and full 100% i18n parity across `en-US`, `zh-TW`, and `ja-JP`.
- [x] Verification: comprehensive core domain, application service, and UI unit test suites (`packages/core/tests/creative-variants.test.ts`, `packages/application/tests/creative-variants.test.ts`, `tests/unit/creative-variant-ui.test.ts`) passing with 15/15 tests.
- [ ] Manual workstation validation: live multi-track audio listening QA, high-DPI touch/gesture workbench verification.

## Completed — Story Graph × Pipeline End-to-End Product Acceptance

[Contract](docs/CONTRACTS.md#story-graph--pipeline-end-to-end-product-acceptance) · [validation](docs/validation-story-graph-pipeline-acceptance.md).

- [x] Fixed fixture: 6 synthetic JPEG images (1280x720, distinct content hashes, GPS along Jiufen trail), 3 fictional memories (user-memory, wish), 3 fictional chat conversations (planned), schematic route, reproducible 30-second mono WAV guide tone (strictly labeled tone), manual Traditional Chinese subtitles; 30s at 30 fps yielding exactly 900 frames.
- [x] Journey 1 & 2: Story Graph to StoryPlan storyboard proposal card deck with 5 dimensions; thematic echo clip instances without duplicate assets; non-destructive preview; adoption into Rough Cut A without overwriting existing manual edit.
- [x] Journey 3 & 4: Guided pipeline execution through review gate (`waiting-review`); legal adoption receipt advancing revision; preview MP4 and visual QA inspection report generation; subtitle-only Variant B incremental run with verified 0 TTS calls and 0 motion generation calls.
- [x] Journey 5: Narration input modification invalidation propagation; marks `scene-prepare` as reuse while invalidating voice narration (`needs-review`) and downstream timing/rendering.
- [x] Journey 6: Injects run cancellation (stops immediately, rejects late arrival), retry (preserves identical input snapshot), source tampering (triggers cache miss fallback), project reopen persistence, and checkpoint restoration with superseded run invalidation (`isRunOutdated`).
- [x] Journey 7: Creative variants A/B review; section isolation proof ("只改本段"); zero-render comparison (`renderCalls === 0`); single-audio playback; pre-adoption automatic checkpoint; baseline restoration back to Baseline A.
- [x] Privacy contracts: Collect Media and Export strictly packages media referenced by the active film, isolating private assets from other variants or library media.
- [x] Bug remediation: Fixed variant clip `beatId` and composition `beatLooks` mapping in `packages/application/src/creative-variants.ts` to prevent invalid beat ID errors.
- [x] Verification: 6/6 tests passing in `tests/integration/story-graph-pipeline-e2e-acceptance.test.ts`, full regression test suites passing (27/27 tests), format check passing, i18n check passing (2,219 keys), ESLint 0 warnings passing, TypeScript/vue-tsc passing, and Vite production client build passing.
- [ ] Manual workstation validation: live multi-track audio listening QA, clean-machine physical GPU video playback, and workstation gates intentionally remain open.

The six PR heads are combined with ancestry preserved in the 0.4.0 release
candidate. [Combined validation](docs/validation-stable-release.md) owns final
full-suite, browser, interchange, native CI and merge/release evidence; feature
validation records retain their original branch identities and historical runs.
