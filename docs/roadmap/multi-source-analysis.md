# Multi-Source Import and Common Analysis

Status: accepted implementation design
Baseline: `main@61a46596d7a2cd17e1c993b2b6fd3f31c5ed807d`
Date: 2026-10-25

## Outcome

OpenFilm will let a user accumulate files, folders, and drops into one editable
source draft, inspect the discovered union, and explicitly start one common
analysis. A folder is a source; an event is an analysis result. The system keeps
those concepts separate and never creates a second timeline.

The first releasable slice is M0–M3: additive selection, prescan, exact content
identity after sealing, immutable analysis scope, shared Desktop/HTTP/CLI logic,
cancel/retry, and run-specific results. M4–M6 add time/GPX evidence, bounded
visual understanding, and explicit review/story adoption. M7 is the validation
gate applied throughout, not a claim that unavailable workstation tests passed.

## Corrected architecture decisions

### Durable semantics versus private operational state

Catalog schema v6 owns portable project meaning: logical source descriptions,
occurrences and membership, content identities, asset content versions,
Expected/Verified Manifests, analysis runs/results, and review decisions.

Native access grants, browser `FileSystemHandle` values, ephemeral `File`
objects, upload/staging paths, leases, provider credentials/consent, and attempt
owner tokens are private operational state. They are excluded from Named
Versions and Collect Media. Browser handles use IndexedDB structured cloning;
ordinary files remain session-only. A reopened draft says that reselection is
required instead of pretending an expired file remains readable.

Every catalog table is classified as `portable-semantic`, `local-operational`,
or `cache`. A test fails when a migration adds an unclassified table. Portable
catalog creation uses this policy and retains only rows reachable from selected
assets; it removes absolute locators, jobs, caches, secrets, and stale drafts.

Schema-v5 Named Version payloads remain immutable and keep their recorded hash.
Inspection, diff, and restore upgrade a private temporary copy to v6. The
upgraded image may become the restored live catalog, but the historical payload
is never rewritten.

### Separate lifecycle state machines

`ImportBatchStatus` is `sealing | sealed | partial | failed | cancelled`.
`AnalysisRunStatus` is `queued | running | completed | partial | failed |
cancelled`. `JobAttemptStatus` is `queued | running | succeeded | failed |
cancelled | abandoned`.

Expected/Verified Manifests, analysis inputs, terminal attempts, and accepted
review decisions are immutable. Retry creates a new attempt for the same fixed
input. Changing selections or analysis configuration creates a new batch/run.
Owner token and generation checks reject a late worker before publication. The
legacy `Job` record remains a compatibility projection, not the source of all
three lifecycles.

### Source access and exact identity

The access classes are `native-path`, `persistent-browser-handle`,
`ephemeral-browser-file`, and `staged-content`. Prescan may report a possible
duplicate from size/name/time but may not call it exact. Exact duplicates require
the complete bytes and server-side SHA-256 during sealing.

Source adapter v1 remains supported. Adapter v2 exposes
`discover(input, options): AsyncIterable<MediaCandidate>`; application code
consumes either through one bounded helper. This prevents 10,000-item roots from
being materialized before progress or cancellation can occur.

### Provider and review boundaries

Remote visual analysis accepts `VisionSampleInput`: sample ID, asset ID, source
hash, source time range, dimensions, MIME type, and bounded encoded frame bytes.
It never receives a local URI or whole `MediaAsset`. ProviderRegistry still
enforces descriptor integrity, destination-scoped consent, cancellation, and a
receipt. A legacy vision provider without this capability is not eligible for
remote M5 work.

A `ReviewDecision` records its base run/result IDs, exact target IDs/ranges,
typed operation, before fingerprint, manifest/story revision preconditions,
optional superseded decision, and `applied | conflicted | superseded` outcome.
Rerunning a model creates new evidence and never overwrites an applied decision.

## Product flow

1. Add files or one or more folders repeatedly; picker cancellation changes
   nothing and selection never starts import automatically.
2. Prescan each source with bounded workers; show discovered, supported,
   possible duplicate, skipped, and failed counts.
3. Adjust inclusion, recursion, and scope. The default scope is
   `selected-sources`; whole-project analysis requires an explicit choice.
4. Start creates an immutable Expected Manifest. Upload/hash/import produces a
   Verified Manifest with successful, failed, and excluded entries.
5. Common analysis reads only that Verified Manifest, including selected assets
   whose import work was reused/skipped.
6. Review results and explicitly adopt selected decisions into StoryGraph.

Standard mode shows source cards, a concise summary, and one primary action.
Expert mode adds bulk exclusion, scope/settings, hashes, revisions, attempts,
cache evidence, and keyboard accelerators. Both are views over the same draft and
application commands.

## Interfaces

Desktop, HTTP, and CLI call the same application services. HTTP adds
`/api/import-draft`, `/api/import-draft/scan`, `/api/import-batches`, and
`/api/analysis-runs` resources with cancel/retry/review subroutes. Mutations carry
`projectId`, `baseRevision`, and `requestId`. Legacy `/api/import` and
`/api/analyze` remain available.

CLI adds `import-batch create|status|cancel|retry`, `analyze --batch`,
`analysis-run status|cancel|retry`, and `analysis-review apply`. CLI source
selection is a versioned JSON manifest; it does not emulate graphical pickers.

New stable errors use dotted names: `import.draftStale`,
`import.batchNotReady`, `import.sourceUnavailable`, `analysis.scopeStale`, and
`analysis.resultStale`. Existing `source.changed`, `jobs.notRunning`, and
`request.invalid` remain authoritative where applicable.

## Milestones and acceptance

- M0: schema/contracts, old snapshot migration, portability/privacy policy.
- M1: native/browser pickers, additive draft, drag/drop, standard/expert UI.
- M2: streaming discovery, membership, staging, content identity, manifests.
- M3: fixed-scope common analysis and independent attempt recovery.
- M4: device clocks, time mappings, GPX segments, assignments, `travel-v1`.
- M5: deterministic sampling, observations, sample-only provider calls.
- M6: immutable review decisions, search, explicit story adoption.
- M7: supported OS/browser, external media, stress, migration, and recovery
  evidence.

Existing AC01–AC28 remain binding. The technical review adds:

- **AC29:** A real v5 named snapshot can inspect, diff, restore, and create its
  automatic checkpoint under v6 without changing the stored snapshot hash.
- **AC30:** Collect Media contains reachable semantic evidence but no access
  handles, absolute staging paths, jobs, caches, tokens, or credentials.
- **AC31:** Persistent browser handles are permission-checked after reopen;
  ephemeral files become `needs-reselection`; completed staging remains usable.
- **AC32:** A 10,000-candidate adapter proves bounded buffering, progressive
  output, prompt cancellation, and no full-array requirement.
- **AC33:** A remote visual provider receives only consented representative-frame
  bytes and evidence fields; full asset URI/media is absent.
- **AC34:** Stale, cross-run, and changed-story review decisions conflict without
  mutation; a new immutable decision may explicitly supersede an old one.
- **AC35:** Standard and expert modes produce identical draft/run semantics;
  keyboard, CJK, responsive layout, project switching, and private-fixture
  redaction pass their gates.

## Validation and release policy

Repository and CI media are synthetic or CC0. Private workstation data must not
enter commits, logs, screenshots, or artifacts. Each PR records exact base/head,
focused regressions, available full gates, unexecuted native/manual gates, and
correctness blockers.

The final automated gate is `pnpm format:check`, `pnpm test:i18n`, `pnpm lint`,
`pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:e2e`,
`pnpm test:interchange`, and `pnpm test:docs-i18n`; run `pnpm test:native` only
with native prerequisites. Windows/macOS/Linux picker and external-drive checks
remain manual workstation gates. No blocker-bearing PR is marked mergeable.
