# Silence Durable Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a durable, idempotent Silence analysis job workflow and strict HTTP API using the existing SilenceService, SQLite reservation, owner recovery and TimelineEditor.

**Architecture:** `SilenceJobService` coordinates queued/running/waiting-review/terminal Job transitions and delegates analysis, immutable Review persistence and editing to existing services. Catalog `BEGIN IMMEDIATE` reservations and owner-token CAS serialize processes; the existing TimelineEditor writes bounded Apply receipts into the same project manifest as the accepted edit.

**Tech Stack:** TypeScript, Vue monorepo packages, Node HTTP server, `node:sqlite`, Vitest, FFmpeg-generated synthetic WAV fixtures.

**Spec:** `docs/superpowers/specs/2026-11-05-silence-durable-jobs-design.md`

## Global Constraints

- Use `Job.type === "silence-analysis"`; do not create another queue, timeline, editor or edit engine.
- Preserve source media immutability and existing SilenceService verified-snapshot checks.
- Reject review creation before publication when a silence ripple would trim or split a clip with local audio automation; the shared ripple primitive does not yet remap gain curves.
- Persist all Job changes in the project SQLite catalog and fence writes by exact owner token and durable state.
- Never auto-apply a finished or recovered analysis.
- Keep retries bound to the original project, asset, composition revision, source hash and normalized analysis options.
- Apply requires the exact stored Review and routes through the existing `TimelineEditor` command `silence.ripple`.
- Keep Project schema version and legacy project behavior compatible; add only an optional bounded receipt field.
- Do not add external packages, private media fixtures, secrets or skipped/weakened assertions.
- Do not merge the resulting PR.

## Review Focus

- Concurrent equal and conflicting request IDs must resolve atomically without starting duplicate work — Task 1 tests.
- A stale source or Composition must remain a stale Job/Review and cannot be silently retargeted during retry or Apply — Tasks 2–3 tests.
- Late progress/completion after cancel, recovery or retry must not overwrite the successor — Tasks 1–3 tests.
- A project save followed by SQLite Job-write failure must be safely acknowledged after restart without applying twice — Task 2 reopen tests and Task 3 HTTP test.
- Symlink, permission, review corruption and DB failure paths must fail closed and leave no false `waiting-review` or completed status — Tasks 2–4 tests.

---

## File map

- `packages/core/src/models.ts`, `packages/core/src/validation.ts`: additive Job status/data and bounded durable Project Apply receipts.
- `packages/core/tests/intelligence.test.ts`, `audio-activity.test.ts` and project validation tests: contract validation, receipt limits, and audio-automation protection.
- `packages/catalog/src/intelligence-store.ts`, `packages/catalog/src/index.ts`: shared reservation, request-id idempotency, owner-fenced transitions, retry and recovery CAS.
- `packages/catalog/tests/intelligence.test.ts`, `analysis-ownership.test.ts`: atomic reservation/transition assertions.
- `packages/application/src/silence.ts`: expected identity inputs and bounded Review read access, keeping current analysis and Apply logic authoritative.
- `packages/application/src/silence-jobs.ts`: new Job orchestration and lifecycle API; no media decoding or timeline command implementation here.
- `packages/application/src/index.ts`: service wiring, lifecycle tracking, and safe startup recovery classification.
- `packages/application/src/editor.ts`: exact durable Apply receipts in the existing editor commit path.
- `packages/application/tests/silence-review.test.ts`, `editor.test.ts`, and new `silence-jobs.test.ts`: Review binding, process restart, stale fencing, cancellation, retry and exactly-once Apply.
- `apps/server/src/server.ts`: strict HTTP routes and local task/AbortController ownership.
- New `tests/integration/silence-jobs-http.test.ts`: real `startServer()` requests over HTTP using only generated WAV data.
- `docs/adr/012-reviewed-media-intelligence.md`, `docs/media-analysis-recovery.md`, new validation record, `TASKS.md`, `ROADMAP.md`: shipped lifecycle/API, evidence and outstanding limits.

## Interfaces

- Task 1 produces `SilenceAnalysisJobDataV1`, `SilenceApplyReceiptV1`, and catalog operations to reserve, transition, retry and recover a `silence-analysis` Job.
- Task 2 produces `SilenceJobService` methods `create(input)`, `run(jobId, signal)`, `get(jobId)`, `getReview(jobId)`, `retry(jobId, requestId)`, `apply(jobId, input)`, and `freshness(job)`. It consumes the catalog APIs from Task 1 and `SilenceService`.
- Task 3 wires the application service and exposes safe startup recovery while keeping the service lifecycle inside `OpenFilmApplication.activeJobs`.
- Task 4 exposes the documented HTTP routes and starts background work only when a new Job was atomically reserved.

## Task 1: Contracts and SQLite durable Job transitions

**Files:**

- Modify: `packages/core/src/models.ts`, `packages/core/src/validation.ts`
- Modify: `packages/catalog/src/intelligence-store.ts`, `packages/catalog/src/index.ts`
- Test: `packages/core/tests/intelligence.test.ts` and project-validation tests
- Test: `packages/catalog/tests/intelligence.test.ts`, `packages/catalog/tests/analysis-ownership.test.ts`

- [x] **Step 1: Add failing contract tests.** Require `waiting-review` only for a valid silence-analysis Job; validate project/asset/composition identity, SHA-256 revision/hash, normalized options, owner and review ID fields. Require project Apply receipts to be unique and at most 200.
- [x] **Step 2: Run targeted tests and verify the new cases fail.** New cases failed against the missing contract/store APIs before implementation.
- [x] **Step 3: Add additive core types and validation.** Define `SilenceAnalysisJobDataV1` and `SilenceApplyReceiptV1`; add `waiting-review` to `JobStatus`; accept optional validated `silenceAnalysis` on `Job` and optional bounded `silenceApplyReceipts` on `OpenFilmProject`.
- [x] **Step 4: Extend the existing catalog reservation.** `reserveSilenceAnalysisJob(job)` performs requestId lookup, request fingerprint comparison, active analysis slot check (including transcribe/waveform/scenes), and INSERT inside one `BEGIN IMMEDIATE`; equal replay returns the existing Job and conflicting reuse is 409.
- [x] **Step 5: Add exact owner/state transitions.** Compare-and-set transitions enforce the lifecycle, stable job identity/owner, monotonic progress and retry owner rotation. `waiting-review` releases the analysis slot. Up to 100 retry request receipts remain durable across later attempts; further retries are rejected at capacity.
- [x] **Step 6: Run targeted tests.** `pnpm exec vitest run packages/core/tests/intelligence.test.ts packages/core/tests/silence-job-contract.test.ts packages/catalog/tests/intelligence.test.ts packages/catalog/tests/analysis-ownership.test.ts` — 4 files / 69 tests passed.

## Task 2: Silence orchestration and durable editor Apply receipt

**Files:**

- Modify: `packages/application/src/silence.ts`, `packages/application/src/editor.ts`
- Create: `packages/application/src/silence-jobs.ts`
- Modify: `packages/application/tests/silence-review.test.ts`, `packages/application/tests/editor.test.ts`
- Create: `packages/application/tests/silence-jobs.test.ts`

- [x] **Step 1: Write service regressions.** Cover revision/source mismatch, Review identity, progress fencing, cancellation, explicit retry, freshness, persistence failure, duplicate Apply across reopen, Undo/Redo and source protections.
- [x] **Step 2: Reproduce a review finding before the fix.** The focused audio-automation proposal test failed against the original ripple path (`1 failed / 27 passed`); a cut could still publish a Review that split an automated clip.
- [x] **Step 3: Extend `SilenceService` without duplicating analysis or editing.** Bound proposal capture and validated Review reads keep existing analysis and Apply authority.
- [x] **Step 4: Implement `SilenceJobService`.** Normalized idempotency, owner-fenced transitions, cancellation/failure and explicit retries delegate to the existing service.
- [x] **Step 5: Add freshness and explicit lifecycle methods.** `current|stale|unverified`, immutable retries, owner rotation and conservative recovery are implemented.
- [x] **Step 6: Make editor Apply receipt durable.** Exact bounded receipts share the project save with `silence.ripple`; replay repairs the Job acknowledgement without applying twice.
- [x] **Step 7: Run focused tests.** The application Job and server composition routes share the active `TimelineEditor`; reopen replay, Undo/Redo, locks, pins, audio timing and automation rejection are covered.

## Task 3: Application lifecycle and recovery wiring

**Files:**

- Modify: `packages/application/src/index.ts`
- Test: `packages/application/tests/silence-jobs.test.ts`, `packages/application/tests/intelligence-owner-recovery.test.ts`

- [x] **Step 1: Add lifecycle tests.** Child-process HTTP tests prove a live foreign owner remains queued, then gets recovered after that process exits; unknown owners require explicit checkpoint confirmation.
- [x] **Step 2: Run lifecycle tests.** Focused Job and real server tests cover both recovery paths.
- [x] **Step 3: Wire one service instance.** The application owns one TimelineEditor shared by durable Jobs and server composition endpoints; Job work remains counted in `activeJobs`.
- [x] **Step 4: Reconcile startup safely.** Silence uses the existing owner-recovery path and retains captured source/revision identities.
- [x] **Step 5: Run lifecycle regressions.** Results are recorded in the dated validation document.

## Task 4: HTTP routes and real integration coverage

**Files:**

- Modify: `apps/server/src/server.ts`
- Create: `tests/integration/silence-jobs-http.test.ts`

- [x] **Step 1: Write real-HTTP tests.** Synthetic WAV/project tests cover the HTTP lifecycle, Undo/Redo and typed failure visibility.
- [x] **Step 2: Verify route behavior with a real server.** Integration tests assert status codes and persisted bodies over HTTP.
- [x] **Step 3: Add strict route adapters.** Create/status/Review/cancel/retry/recover/apply routes validate request fields.
- [x] **Step 4: Start only newly reserved work.** Only the transaction winner launches analysis; cancellation and shutdown remain owner-fenced.
- [x] **Step 5: Verify process races.** Two live server processes reserve one request ID as one Job; a separate process recovery test exercises a dead owner.

## Task 5: Documentation and complete requested gates

**Files:**

- Modify: `docs/adr/012-reviewed-media-intelligence.md`, `docs/media-analysis-recovery.md`, `TASKS.md`, `ROADMAP.md`
- Create: `docs/validation-silence-durable-jobs.md`
- Modify: `docs/en/adr/012-reviewed-media-intelligence.md`, `docs/en/media-analysis-recovery.md`, and English validation/index links as required by `test:i18n`/docs checks

- [x] **Step 1: Document the exact API contract and state semantics.** API shapes, state/freshness, idempotency, owner recovery, receipts and automation limitation are recorded in root documentation and English mirrors.
- [x] **Step 2: Run documentation/i18n and final formatting gates.** `pnpm format:check`, `pnpm test:i18n` and `pnpm test:docs-i18n` passed.
- [x] **Step 3: Run requested and relevant verification.** `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test:contracts`, focused application/catalog tests, HTTP integration and related audio media tests passed. `pnpm test`, full `pnpm test:media`, browser E2E and native workstation gates were not run and are reported in the validation record.
- [ ] **Step 4: Final review and PR.** Review exact base/head and changed files; record test evidence, process-test limits and unresolved native/media gates. Push a dedicated PR from `codex/silence-durable-jobs`, keep it unmerged, and attach its URL.
