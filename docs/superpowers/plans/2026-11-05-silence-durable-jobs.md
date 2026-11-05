# Silence Durable Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a durable, idempotent Silence analysis job workflow and strict HTTP API using the existing SilenceService, SQLite reservation, owner recovery and TimelineEditor.

**Architecture:** `SilenceJobService` coordinates queued/running/waiting-review/terminal Job transitions and delegates analysis, immutable Review persistence and editing to existing services. Catalog `BEGIN IMMEDIATE` reservations and owner-token CAS serialize processes; the existing TimelineEditor writes bounded Apply receipts into the same project manifest as the accepted edit.

**Tech Stack:** TypeScript, Vue monorepo packages, Node HTTP server, `node:sqlite`, Vitest, FFmpeg-generated synthetic WAV fixtures.

**Spec:** `docs/superpowers/specs/2026-11-05-silence-durable-jobs-design.md`

## Global Constraints

- Use `Job.type === "silence-analysis"`; do not create another queue, timeline, editor or edit engine.
- Preserve source media immutability and existing SilenceService verified-snapshot checks.
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
- `packages/core/tests/intelligence.test.ts` and project validation tests: contract validation and receipt limits.
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

- [ ] **Step 1: Write failing service tests.** Cover captured revision mismatch before analysis, actual hash mismatch, immutable Review association, progress callback fencing, cancellation, explicit retry only, stale freshness, persistence failure, and duplicate Apply across closing/reopening the application.
- [ ] **Step 2: Run the focused tests and verify failure.** Run `pnpm exec vitest run packages/application/tests/silence-review.test.ts packages/application/tests/editor.test.ts packages/application/tests/silence-jobs.test.ts`.
- [ ] **Step 3: Extend `SilenceService` without duplicating analysis or editing.** Add a bound proposal entry point requiring the captured `baseRevision`, expected `sourceHash` when available, signal and progress callback; expose only a validated read of the existing private Review file. Keep `verifyReviewedProposal()` and `apply()` as acceptance authorities.
- [ ] **Step 4: Implement `SilenceJobService`.** Normalize options before fingerprinting; create the queued Job through Task 1; claim exactly once; run `SilenceService`; persist the source hash and progress by owner-fenced CAS; persist Review first and only then move the Job to `waiting-review`. Cancellation/failure writes a terminal state only if the owner still owns the running attempt.
- [ ] **Step 5: Add freshness and explicit lifecycle methods.** Compare the captured revision and known asset hash without re-analysis; expose `current|stale|unverified`. Retry accepts only failed/cancelled Jobs, keeps the original revision/options/hash, rotates the owner, and checks current identities. Recover delegates to the existing conservative owner proof/checkpoint path and never starts work.
- [ ] **Step 6: Make editor Apply receipt durable.** For one exact `silence.ripple` command with `requestId`, persist a bounded receipt `{ version, jobId, requestId, fingerprint, compositionId, reviewId, baseRevision, appliedRevision, appliedAt }` in `OpenFilmProject` in the same manifest save as the edit. Before stale-review validation, an exact receipt replay acknowledges its saved revision without applying again; a changed payload with the same request ID returns 409. On duplicate Apply, finish a waiting-review Job from the durable receipt.
- [ ] **Step 7: Run focused tests and commit.** Assert reopen replay does not change composition or history twice, review/source/revision mutations are rejected, locks/pins/audio contracts remain enforced, cancellation leaves no review and stale callbacks cannot publish. Commit `feat(application): orchestrate durable silence reviews`.

## Task 3: Application lifecycle and recovery wiring

**Files:**
- Modify: `packages/application/src/index.ts`
- Test: `packages/application/tests/silence-jobs.test.ts`, `packages/application/tests/intelligence-owner-recovery.test.ts`

- [ ] **Step 1: Add failing lifecycle tests.** Open a project with queued/running silence Jobs and prove startup recovery marks only proven-dead owners failed; live/unknown owners remain untouched. Confirm recovery never creates a Review or edits the timeline.
- [ ] **Step 2: Run those tests and verify failure.** Run `pnpm exec vitest run packages/application/tests/silence-jobs.test.ts packages/application/tests/intelligence-owner-recovery.test.ts`.
- [ ] **Step 3: Wire one service instance.** Construct `application.silenceJobs` around `application.silence`, shared catalog and existing owner helpers; track worker activity in `activeJobs`, so close/save guards retain current behavior.
- [ ] **Step 4: Reconcile startup safely.** Exclude `silence-analysis` from the generic job failure loop and include it in the existing analysis owner recovery path; preserve exact Job checkpoint and source/revision data.
- [ ] **Step 5: Run lifecycle regressions and commit.** Commit `feat(application): wire silence job lifecycle and recovery`.

## Task 4: HTTP routes and real integration coverage

**Files:**
- Modify: `apps/server/src/server.ts`
- Create: `tests/integration/silence-jobs-http.test.ts`

- [ ] **Step 1: Write failing real-HTTP tests.** Use `startServer()` and a generated WAV/project. Exercise create/idempotent replay, GET Job/Review, cancel, retry, recover confirmation/checkpoint, exact Apply, duplicate Apply after reopen, stale source/revision/review rejection, unsupported fields, project mismatch and persistence failures.
- [ ] **Step 2: Run the test and verify failure.** Run `pnpm exec vitest run tests/integration/silence-jobs-http.test.ts`.
- [ ] **Step 3: Add strict route adapters.** Implement `POST /api/silence/jobs`, `GET /api/silence/jobs/:jobId`, `GET /api/silence/jobs/:jobId/review`, and POST `cancel|retry|recover|apply` under `/api/silence/jobs/:jobId/...`. Validate exact keys, content IDs, request IDs and checkpoint fields.
- [ ] **Step 4: Start only newly reserved work.** Register the local AbortController before launching; return `202` after durable reservation; repeated create returns the existing Job without a second task. Cancel only local controllers; wait for terminal completion and reject remote/unknown owners for cancellation.
- [ ] **Step 5: Verify HTTP and process races.** Add a child-process catalog test for concurrent reservation and owner recovery. Verify old callbacks after cancel/retry cannot change the successor. Commit `feat(server): expose durable silence analysis jobs`.

## Task 5: Documentation and complete requested gates

**Files:**
- Modify: `docs/adr/012-reviewed-media-intelligence.md`, `docs/media-analysis-recovery.md`, `TASKS.md`, `ROADMAP.md`
- Create: `docs/validation-silence-durable-jobs.md`
- Modify: `docs/en/adr/012-reviewed-media-intelligence.md`, `docs/en/media-analysis-recovery.md`, and English validation/index links as required by `test:i18n`/docs checks

- [ ] **Step 1: Document the exact API contract and state semantics.** Record request/response shapes, status and freshness meanings, errors, idempotency, Apply receipts and owner recovery. State that review completion never auto-applies and retry never changes source/revision.
- [ ] **Step 2: Run the exact documentation/i18n gates before final validation.** Run `pnpm format:check`, `pnpm test:i18n`, `pnpm test:docs-i18n`.
- [ ] **Step 3: Run requested and relevant verification.** Run `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test:contracts`, focused application/catalog tests, `tests/integration/silence-jobs-http.test.ts`, and existing `packages/application/tests/silence-review.test.ts` plus silence media tests. Run the full `pnpm test` if resources permit; report exact counts and any unrun gates.
- [ ] **Step 4: Final review and PR.** Review exact base/head and changed files; record test evidence, process-test limits and unresolved native/media gates. Push a dedicated PR from `codex/silence-durable-jobs`, keep it unmerged, and attach its URL.
