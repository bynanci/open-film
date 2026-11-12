# Source Analysis Preparation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Reduce repeated verified-binding scans in existing Common Analysis without changing accepted evidence or adding a scheduler.

**Architecture:** Reuse `SourceAnalysisService.prepare()` and its existing per-asset grouping. Keep the original binding sequence for fingerprinting, all within-limit source checks and the three freshness checkpoints. Reject scopes above the existing distinct-asset limit before asset hydration.

**Tech Stack:** Existing TypeScript, SQLite Catalog, Vitest and Node benchmark tools; no dependency changes.

**Spec:** The archive-analysis prerequisite in `docs/roadmap/next-issues-2026-11-11.md`: measure the existing workflow before extending scheduling. The user has authorized continued roadmap implementation and subagent-driven execution. This bounded design is an engineering choice within that scope.

## Global Constraints

- Keep 10,000 distinct assets and 50,000 verified bindings as existing limits.
- Preserve every within-limit source hash check, sorted asset order, binding order, input fingerprint, config hash and run identity.
- Keep owner fencing, cancellation/retry, immutable evidence and Review/Accept unchanged.
- No additional Timeline, Mixer, Job engine, schema migration or provider.
- The only deliberate error-order change is an oversized distinct scope returning `request.tooLarge` / 413 before missing/stale asset checks; no run or job may be persisted.
- Synthetic metadata only; no private media. Author/sign-off: NAN CHUN WANG <by.nanci.tw@gmail.com>.
- Do not merge PR #129, tag, publish, sign installers or change repository controls.

## Approaches

1. Reuse grouping and bound hydration: selected, because it removes a demonstrated quadratic scan without changing the workflow.
2. Add a background scheduler now: deferred, because the measured bottleneck and current durable services should guide that larger design.
3. Raise timeouts or reduce input limits: rejected, because these do not fix the repeated work.

## Review Focus

- A stale hash in the last of several bindings for one asset must still reject.
- Manifest ordering and repeated asset bindings must retain exact identity and result binding order.
- Oversized distinct scopes must reject without reading thousands of asset rows or reserving work.
- All three prepare passes must still observe source/manifest changes; no persistent memoization.
- Benchmark preparation and complete workflow separately; metadata-only results cannot certify real archive decoding, native memory or scheduling.

### Task 1: Indexed preparation and resource-bound regressions

**Files:** Modify `packages/application/src/source-analysis.ts`; add focused preparation tests under `packages/application/tests/`.

**Interfaces:** Existing public `SourceAnalysisService.createRun(input)` and Catalog boundary; no production interface expansion.

- [x] Add deterministic tests for more than 10,000 distinct IDs returning 413 before asset reads/run/job writes, with an intentionally stale oversized scope to pin precedence.
- [x] Observe the resource regression fail on the baseline; retain its exact command and output outside the repository.
- [x] Reuse grouped binding rows (or equivalent one-pass hash index), preserve ordered binding IDs, and check distinct size before hydration.
- [x] Verify legal repeated bindings, late mismatched hash, missing asset/hash, ordering, exact fingerprint/run identity, and supported boundary counts.
- [x] Run focused tests plus the unchanged source-analysis application suite; commit signed off after review.

### Task 2: Comparable measurements and bounded roadmap evidence

**Files:** Add a reproducible synthetic benchmark under `scripts/`; paired dated validation under `docs/validation/` and `docs/en/validation/`; update `TASKS.md` and `ROADMAP.md`.

**Interfaces:** Measure existing application/Catalog services. No production diagnostics API. Record source SHA/diff digest, tool versions, fixture identity, repetitions, wall/CPU/heap/RSS costs and semantic output identities.

- [x] Run identical fixed synthetic cases on baseline and optimized source, isolated from other heavy work; report preparation separately from complete create/run/publication and setup.
- [x] Compare fingerprints, run IDs and evidence semantics, retaining raw measurements externally and a sanitized result summary in documentation.
- [x] State any benchmark exclusions and avoid claiming native/decoder/encoder speedups.
- [ ] Mark only the narrow preparation child complete; leave background scheduling and workstation parents open.
- [x] Run formatting, i18n, lint, typecheck, contracts, focused media tests and build; obtain independent task and final branch reviews.
- [ ] Create a dedicated draft PR with exact base/head, actual test counts and remaining gates; inspect hosted exact-head CI before considering readiness.
