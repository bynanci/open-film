# Pipeline Fixture Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cancel and drain owned acceptance actions before fixture teardown.

**Architecture:** One fixture-only owner records action promises and run IDs. Existing public cancellation drains work; catalog close and directory removal follow settlement.

**Tech Stack:** TypeScript, Vitest, existing application API, procedural FFmpeg media.

**Spec:** [fixture drain design](../specs/2026-11-12-pipeline-fixture-drain-design.md).

## Global Constraints

- Keep all four Journey assertions, 10s duration, 1920×1080/30fps, 120s test/hook budgets, retry policy, real rendering, and production code unchanged.
- Execute on verified current main; recheck the inspected f8 APIs against the actual starting SHA.
- No PID/proc dependency, private media, dependency/CI/pin changes, or product drain API.

## Review Focus

- Review/retry launches an internal controller after an asynchronous idle interval.
- Timed-out callbacks attempt another owned action after cleanup begins.
- Rejected actions and cleanup errors retain their original evidence.
- Partial setup leaves optional resources and no stale previous-case references.
- Queued/multiple owned runs must all settle before shared catalog closure.

---

### Task 1: Own and drain the pipeline acceptance fixture

**Files:**

- Create `tests/fixtures/pipeline-fixture-owner.ts`: one lifecycle helper.
- Create `tests/unit/pipeline-fixture-owner.test.ts`: deterministic ordering/error cases.
- Create `tests/integration/pipeline-fixture-cleanup.test.ts`: real failure-cleanup regression.
- Modify `tests/integration/pipeline-workbench-acceptance.test.ts`: wrappers and teardown only.

**Interfaces:** `createPipelineFixtureOwner()` exposes `ownAction<T>(runId, launch): Promise<T>`, `cleanup(app?, directory?): Promise<void>`, and readonly `pendingCount`. The structural app needs only existing `cancelRun` and `catalog.close`; no product API is produced.

- [ ] Write RED unit cases using deferred actions: cleanup cannot close/remove before settlement; `cancelRun` is called first; multiple IDs/queued actions drain; a deferred review/retry controller is cancelled after becoming active; closing blocks new launch thunks; partial setup is safe. Assert the returned action rejects with the identical original error, sentinel failure survives successful cleanup, and cleanup failures remain visible without deletion of an unsettled/open fixture.
- [ ] Run `pnpm exec vitest run tests/unit/pipeline-fixture-owner.test.ts --maxWorkers=1`. Use a helper initially extracted from the existing close/remove semantics without cancellation/drain; retain genuine ordering failures. A missing import/helper is not the required behavioral RED.
- [ ] Add the real regression before implementing drain. Reuse the same procedural photo/story values; add ten-second voice import to pause at narration review. Own `submitReview(..., "step-3", "accepted")`; await `expect.poll(..., {timeout: 30_000})` on typed `catalog.listJobs()` render progress greater than zero, then inject a sentinel error. Run against the extracted legacy teardown and retain behavioral RED: pending action remains. Guard the actual catalog-close boundary with a pending-settlement assertion BEFORE closing. Legacy teardown fails there, leaving the catalog open for independent public cancel/drain in finally. Never delete or close the real RED fixture before that independent cancellation.
- [ ] Implement only owner cleanup: immediate nonrejecting settlement observers, original returned promises, cancellation waves with event-loop yields, then ordered close/remove. Keep the regression unchanged and rerun unit/regression GREEN. Assert cancelled action settlement and durable `cache/pipeline-runs.json` cancellation before catalog close, `pendingCount === 0`, removed directory, no later settlement callback, and unchanged sentinel identity. No child handle or OS process inspection is needed: the owned action awaits `runProcess` close.
- [ ] Wrap every acceptance `startRun`, `submitReview`, and `retryRun` call with `ownAction`. Reset owner/app/path at setup entry; replace afterEach with awaited owner cleanup. Preserve all journey assertion text and fixture values.
- [ ] Run `pnpm exec vitest run tests/unit/pipeline-fixture-owner.test.ts tests/integration/pipeline-fixture-cleanup.test.ts tests/integration/pipeline-workbench-acceptance.test.ts --maxWorkers=1 --no-file-parallelism`; require unit/regression pass and all four original journeys pass. Then run `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and `pnpm test:ci-partition`. Review the diff for forbidden changes and retain RED/GREEN logs separately.
- [ ] Commit the four test-only files after checks. Report starting SHA, results and limits; original historical timeout causality remains unresolved.

Coordinator owns TASKS/ROADMAP/paired validation updates, independent review, broad gates and eventual PR/merge. The implementer owns only four test paths and commits with NAN CHUN WANG <by.nanci.tw@gmail.com> DCO; no remote operation. Starting exact main: a70f96f1781f6984e140cfd5d4860134c187a003.
