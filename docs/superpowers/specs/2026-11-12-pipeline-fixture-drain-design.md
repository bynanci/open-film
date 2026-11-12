# Pipeline acceptance fixture cleanup design

**Goal:** Make the acceptance fixture cancel and drain its own pipeline actions before closing SQLite and removing temporary media. This is one test-only lifecycle correction.

**Evidence:** the independently retained owned-render reproduction (`/workspace/openfilm-next-issues-20261112/pipeline-cleanup-repro/result.json`) demonstrates catalog close/removal returning while an exact owned FFmpeg child and API action remained active. It does not establish the cause of the earlier local timeouts. Preserve that original 6177-pass/3-failure result alongside the later isolated 4/4 pipeline, 65/65 NLE, and interchange passes.

**Baseline:** Source inspection used `f8f4cc8b9eae20098aede4c84320716e305b6218`. Execution must start from verified current main (parent reports `a70f96f1781f6984e140cfd5d4860134c187a003`) and recheck these APIs before editing.

**Chosen approach:** One small fixture owner in `tests/fixtures/pipeline-fixture-owner.ts`, used by the existing acceptance file and focused regressions. Inline teardown would make ordering harder to test; a product cancellation redesign is outside this fix.

Expose `createPipelineFixtureOwner()` returning:

- `ownAction<T>(runId: string, launch: () => Promise<T>): Promise<T>`;
- `cleanup(app?: FixtureApplication, directory?: string): Promise<void>`;
- readonly `pendingCount: number`.

`FixtureApplication` structurally requires only `pipeline.cancelRun(runId)` and `catalog.close()`. Register run IDs and observe each launched promise immediately with both fulfillment/rejection handlers. Return the original action promise: its value/error remains available to the journey. Use a nonrejecting settlement latch; never discard a rejecting `.finally()` promise. Refuse new launches once cleanup starts.

The existing public `startRun(id, {signal?})` returns the complete owned action. `submitReview(id, stepId, decision, reviewData?)` and `retryRun(id)` resume internally and expose no signal option; wrap every call, including review approvals and retries. They first persist `idle`, then call `startRun`, so a cancellation before the internal controller exists can miss it. Cleanup therefore cancels all owned IDs and, while any action remains pending, yields one event-loop turn and repeats existing `cancelRun` calls until all latches settle. These are cancellation observations, not retries of pipeline work. Do not race a drain timeout against destructive cleanup.

Only after settlement may cleanup close the catalog, then remove the directory. `runProcess` settles on child `close`, so awaiting the owning API action supplies the child-drain boundary without PID/proc APIs or a new production interface. A cancellation/drain failure must remain visible; never remove an unsettled fixture or remove after catalog closure fails. Do not intercept/replace journey assertion failures; Vitest retains case and hook errors separately.

Initialize a fresh owner and clear optional `app`/directory references before each setup. This handles setup failing before directory creation, before application creation, or during asset generation. Existing journey operations receive thin owner wrappers; their assertions remain verbatim.

**Proof:** Deterministic deferred-promise unit cases establish cancel→settle→close→remove, the review/retry pre-controller gap, late-launch rejection, partial setup, and original error identity. One real regression uses ten-second imported voice, pauses at step 3, starts long work through `submitReview`, and waits for typed catalog render progress with a 30-second condition barrier inside the unchanged 120-second test budget. Inject a sentinel failure; cleanup must yield a settled cancelled action, durable cancelled run state observed before close, zero pending actions, removed fixture, and the unchanged sentinel. The action-close contract replaces process inspection.

Keep all four Journey assertions, 10s duration, 1920×1080/30fps, 120s test/hook budgets, retry policy, real rendering, and production code unchanged. If public cancellation cannot drain this observed action, stop and report the API limitation instead of adding an engine or production drain API. No release/admin work is included.

The real behavioral RED must guard the catalog-close boundary with an assertion that owned work already settled, before actually closing it. The legacy cleanup then fails at this boundary while the original catalog remains available for independent cancellation and draining. Its finally cleanup uses the real public cancel API and owning promise; no unsafe child PID/proc cleanup, fake renderer or destructive failed-RED teardown.
