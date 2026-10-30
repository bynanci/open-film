# D6A Managed Proxy Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox syntax for tracking.

**Goal:** Make preview preparation bounded, cancellable, recoverable and safe to
clean without changing the saved film or original media.

**Architecture:** One application-owned queue extends the existing private Job
model; media generation reuses `createProxy`, source verification and catalog
publication. A project-private policy/lease and managed cache hold operational
state. Library, HTTP and CLI share the service.

**Tech Stack:** TypeScript, Node SQLite/filesystem, FFmpeg/FFprobe, Vue 3,
Vitest and Playwright; no new dependency.

**Spec:** `docs/superpowers/specs/2026-10-30-proxy-storage-design.md`

## Global Constraints

- Preserve project schema, catalog v6, Composition, locks and Undo/Redo.
- Never overwrite originals, run project code or upload media.
- One worker, 128 active tasks, default 5 GiB quota; explicit 1 MiB–1 TiB policy.
- Private operational state is excluded from portable snapshots and packages.
- Use synthetic sources and record unavailable workstation evidence honestly.

## Review Focus

- A second application/status reader must preserve an alive or unknown worker.
- Cancel or changed-source completion must leave the previous valid proxy intact.
- Full/offline/protected caches must never trigger destructive source cleanup.
- Same request with a changed body, an unsafe cache name or an unknown receipt
  version must fail before a child process or deletion.
- A project switch or delayed health/rebuild response must not update another
  workspace, and output must still use original sources after cache removal.

---

### Task 1: Closed contracts, durable queue and verified source helper

**Files:** Create `packages/core/src/proxy-cache.ts`,
`packages/application/src/proxy-cache.ts`, `packages/media/src/verified-source.ts`
`packages/application/src/proxy-cache-store.ts` and
`packages/application/tests/proxy-cache.test.ts`; modify core/media barrels,
`packages/core/src/models.ts`, `packages/catalog/src/index.ts` and application
construction/recovery in `packages/application/src/index.ts`.

**Interfaces:** `ProxyCacheService.enqueue(input)`, `runPending(options)`,
`cancel(input)`, `resume(input)` and `health(input)` own project/request checks;
`withVerifiedSourceFile(path, hash, consume, options)` exposes a verified private
source only inside a trusted callback. Ready sidecars retain provenance across
Named Version restore; `prepareImportedAsset(asset, signal)` preserves synchronous
import completion through the same managed FIFO. Catalog offers bounded job queries and
uses its existing synchronous `withProjectWrite` publication boundary.

- [x] Add failing contract/queue tests for 128-task bounds, exact request retries,
      stale source/owner/generation, live-reader recovery, Named Version restore,
      future imports and cancel/reopen.
- [x] Run the focused tests and retain the intended failing assertions.
- [x] Implement the contracts/service/helper with one owned worker and no
      original/Composition writes; preserve legacy frame-sampling behavior.
- [x] Pass focused queue/media tests and commit the independently testable slice.

### Task 2: Quota, provenance-owned cleanup and actual media proof

**Files:** Extend the service/tests; create a focused cache-path/protection test
file if necessary. Modify `createProxy` only for a bounded output-byte option.

**Interfaces:** `setPolicy(input)`, `previewCleanup(input)`,
`acceptCleanup(input)`, `verify(input)` and `touch(assetId)` operate only on
versioned managed receipts; cleanup acceptance binds exact candidates/bytes.

- [ ] Add failing quota, current-Composition/locked/offline protection, unknown
      receipt, symlink, same-size output replacement and cleanup-race regressions.
- [ ] Implement bounded inventory, LRU selection, protected-entry checks and
      no-replace output with hash/probe evidence and explicit verification.
- [ ] Generate/decode actual synthetic video/audio proxies; assert duration,
      content/source hashes and unchanged original render after cache cleanup.
- [ ] Pass focused tests and commit the storage/provenance slice.

### Task 3: Shared HTTP/CLI and accessible Library controls

**Files:** Modify server, CLI, desktop API/App, app locale modules and product
styles; create `ProxyStoragePanel.vue`, HTTP/CLI regressions, component tests and
`tests/e2e/proxy-storage.spec.ts`.

**Interfaces:** Project-bound `/api/proxy-cache` status/policy/queue/run/cancel/
resume/verify/cleanup routes and CLI `proxy` subcommands call the same service.
The panel emits acknowledged proxy changes to refresh the owning workspace.

- [ ] Add failing HTTP cancellation/foreign-project, CLI reopen and component
      stale-response/keyboard regressions.
- [ ] Implement registered background work and queue-independent cancellation;
      integrate the existing project close/job lifetime.
- [ ] Add progressive Library controls, three locales, announced status, explicit
      cleanup preview/accept, CJK wrapping and coarse-pointer targets.
- [ ] Pass real API/browser regressions, then commit the shared workflow.

### Task 4: Review, full gates and roadmap handoff

**Files:** Update TASKS, ROADMAP, architecture/contracts, validation and required
English reference mirrors. Add evidence to the private execution ledger.

- [ ] Complete one independent final code review and one regression-backed fix pass.
- [ ] Run format, i18n/docs, lint, typecheck, unit/application, build, CLI smoke,
      interchange and all Chromium regressions; retain native/workstation limits.
- [ ] Create the D6A PR with exact base/head and evidence, preserving PR #63.
- [ ] Reconcile remaining D6B scope against the actual Collect planner before
      beginning its separate threat/compatibility design and implementation plan.
