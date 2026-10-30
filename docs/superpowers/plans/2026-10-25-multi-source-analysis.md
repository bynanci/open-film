# Multi-Source Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox syntax for tracking.

**Goal:** Add durable multi-source selection, import sealing, scoped common
analysis, time/track evidence, sampled visual observations, and reviewable story
adoption without replacing OpenFilm's existing project, catalog, or timeline.

**Architecture:** Project-semantic evidence lives in catalog schema v6. Local
access grants, browser handles, staging leases, and execution attempts remain
private operational state. Every analysis reads an immutable verified manifest;
Desktop, HTTP, and CLI call the same application services.

**Tech Stack:** Vue 3, TypeScript, SQLite, Node.js, Tauri 2, Vitest,
Playwright, FFmpeg/FFprobe.

**Spec:** `docs/roadmap/multi-source-analysis.md`

## Global Constraints

- Preserve existing asset IDs, project schema contracts, locks, Undo/Redo,
  autosave, relink, Named Versions, Collect Media, and legacy import APIs.
- Never execute project HTML or JavaScript and never overwrite source media.
- Remote providers receive only explicitly consented bounded samples, never a
  source URI or complete media asset.
- Repository and CI fixtures are synthetic or CC0; workstation-private data is
  never logged or uploaded as an artifact.
- Error identifiers use the existing dotted taxonomy.

## Review Focus

- A schema-v5 named version must still inspect, diff, and restore after v6.
- Browser File objects and persistent handles must not be represented as if
  they have the same lifetime.
- Cancellation, retry, and late workers must not attach results to stale bytes,
  a stale manifest, or a different project.
- Ten-thousand-item scans must remain bounded and cancellable.
- Review decisions must remain stable across model reruns and story changes.

---

### Task 1: M0 contracts, catalog migration, and portability policy

- [x] Add failing catalog, project-version, portable snapshot, and state-machine
      tests.
- [x] Add schema-v6 semantic tables, explicit table policies, and an immutable
      snapshot upgrade path.
- [x] Add source/batch/run/attempt/review public contracts and dotted errors.
- [x] Update roadmap, task queue, architecture/contracts, and validation docs.
- [x] Run focused tests, full `pnpm test`, typecheck, lint, and commit.

### Task 2: M1 source draft and platform pickers

- [x] Add failing Rust, component, application, and browser tests.
- [x] Add `pick_folders`, additive source draft commands, typed native drop
      classification, and browser handle storage in IndexedDB.
- [x] Add standard and expert presentations over the same source draft.
- [x] Verify keyboard, CJK, responsive, project-switch, and cancel behavior.

### Task 3: M2 streaming discovery and membership

- [x] Add a v2 `AsyncIterable` source adapter and legacy materializing wrapper.
- [x] Persist occurrences and many-to-many selection membership.
- [x] Add bounded scanning, recursive policy, symlink rejection, pagination, and
      a 10,000-item cancellation/backpressure regression.

### Task 4: M2 staging, identity, and sealing

- [x] Add private durable staging, lease/orphan recovery, full SHA-256 content
      identity, immutable asset content versions, and Expected/Verified Manifests.
- [x] Reject absolute/escaping browser paths and distinguish possible from exact
      duplicates.
- [x] Verify restart, relink, source-change, partial, and sealing-retry cases.

### Task 5: M3 scoped common analysis

- [x] Add manifest-scoped run-specific event and duplicate outputs.
- [x] Add attempt ownership, cancellation, retry, idempotency, late-result
      fencing, and selected-source/project-catalog scope.
- [x] Wire HTTP, CLI, and Desktop to shared application methods while retaining
      legacy endpoints.

### Task 6: M4 time and GPX evidence

- [x] Add versioned device clock/context mappings and GPX track assignments.
- [x] Preserve unknown/conflicting time, timezone, speed, and track evidence.
- [x] Add `travel-v1` fixtures without interpolating across track gaps.

### Task 7: M5 sampled visual observations

- [x] Add deterministic representative-frame evidence and a sample-only vision
      provider contract.
- [x] Add consent, bounded payload, validation, cache invalidation, and unknown
      classification regressions.

### Task 8: M6 review, story adoption, and M7 release evidence

- [x] Add immutable typed decisions with lineage, fingerprints, preconditions,
      conflicts, and supersession.
- [x] Add merge/split/correct/search/adopt UI and API; no result changes StoryGraph
      before explicit acceptance.
- [x] Run every available automated gate, record native/workstation manual gates
      honestly, and complete final branch review.

### Task 9: M6 review interaction and recovery optimisation

- [x] Fence out-of-order result searches and invalidate previews when any
      reviewed input, result selection, run or project changes.
- [x] Reuse the exact acceptance receipt after an ambiguous transport failure;
      keep the reviewed operation frozen until recovery finishes.
- [x] Make supersession an explicit choice instead of choosing an unrelated
      conflicted decision automatically.
- [x] Reuse existing StoryGraph asset-node IDs during adoption and preserve
      successful decisions across retry and reopen.
- [x] Complete focused application/component/browser regressions and the
      required available gates; retain unequipped workstation gates as open.

### Task 10: final review correctness closure

- [x] Bind reusable browser staging to current discovery metadata and fence
      uploads completing after a rescan; preserve verified reopen.
- [x] Reject unknown travel fields at every level and reconstruct closed portable
      travel records without leaking private sentinels.
- [x] Keep run/Activity cancellation available during long analysis and abort
      disconnected discovery without publishing complete readiness.
- [x] Verify source bytes in a private streaming snapshot before frame extraction
      or provider disclosure; share one snapshot across up to three samples.
- [x] Check cancellation, process/attempt ownership, generation, run status and
      input fingerprint inside result publication; preserve live status readers.
- [x] Project immutable corrections/groups/ranges for search and subsequent
      adoption, including decision lineage in preview preconditions.
- [x] Bound splits to reviewed timed sources and actual duration; support
      multi-result adoption in Desktop.
- [x] Finish full available gates after the single review fix pass and record
      remaining workstation gates.
