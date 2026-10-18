# Task status

This checklist describes implementation in the 0.1.0 source tree. A checked item
means behavior or a concrete artifact exists; it does not certify every operating
system or downstream NLE. Commands and test responsibilities are in
[README.md](README.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

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
- [x] Apply the selected GPL-3.0-only derivative distribution terms, preserve exact
      historical Apache text/notices and fixture CC0 grants, and document AGPL's
      alternative network-service scope in [licensing](docs/licensing.md).
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

_Modified by OpenFilm contributors on 2026-10-18. Preexisting Apache-2.0 grants remain available; the current derivative distribution is GPL-3.0-only. See LICENSE and NOTICE._
