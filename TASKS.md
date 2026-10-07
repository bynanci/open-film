# Task status

This checklist describes implementation in the 0.1.0 source tree. A checked item
means behavior or a concrete artifact exists; it does not certify every operating
system or downstream NLE. Commands and test responsibilities are in
[README.md](README.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## P0 — Foundation and media workflow

- [x] pnpm monorepo, strict TypeScript, lint/format/typecheck/test/build scripts.
- [x] Apache-2.0 LICENSE/NOTICE and license decision record.
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

Vision, Highlights and Captions remain deferred. Geometry and transcript productivity
is tracked separately below; interface-only work is not completion.

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
