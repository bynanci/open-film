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
- [ ] Local vision, embeddings, transcript, and language implementations.
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
