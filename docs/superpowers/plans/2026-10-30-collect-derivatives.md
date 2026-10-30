# D6B — Derived Collect Media implementation plan

> **For agentic workers:** use `superpowers:executing-plans` task by task.

**Goal:** Add reviewed trimmed-original and explicitly offline Collect delivery.
**Architecture:** Extend the existing Collect planner/verifier and v2 lineage;
source-use windows are projections over the existing Composition.
**Tech stack:** TypeScript, existing SQLite snapshot adapter, FFmpeg, Vue3,
Vitest/Playwright; no new dependency.

## Global constraints

- Preserve v1/default full-original packages and project schema1/Catalogv6.
- No original/Composition mutation, second timeline/scheduler, private cache,
  credentials or provider upload in portable packages.
- Handles default2s, bounded0–10s; preview remains review-only/non-executable.
- Execution requires actual original-baseline decoded frame/audio/time proof.

## Review focus

- Locked/opaque/transcript-clock references retain original identity.
- Disjoint uses never silently retain gaps while claiming exact trimming.
- Source/revision changes invalidate accept/publication across project switches.
- Unknown receipt versions, paths and source maps fail before write or decode.
- Offline previews cannot be presented as original-quality masters.

Use `superpowers:executing-plans`; preserve a private execution ledger and
RED→GREEN evidence. Spec: `2026-10-30-collect-derivatives-design.md`.

## Task 1 — Read-only coverage contract and planner

**Files:** `packages/core/src/collect-delivery.ts`, core barrel,
`packages/application/src/collect-coverage.ts`, `tests/unit/collect-coverage.test.ts`.
**Interfaces:** `validateCollectDeliveryOptions(unknown)` returns normalized
`CollectDeliveryOptionsV1`; `planCollectCoverage(CollectCoverageInput)` returns
`CollectCoveragePlanV1` with explicit `executable:false`. Caller supplies opaque
and evidence-bound asset IDs; captured classification belongs to Task2.
**Verification:** new29 cases plus existing shared Sequence/timebase tests:
`pnpm exec vitest run tests/unit/collect-coverage.test.ts packages/core/tests/sequence.test.ts packages/core/tests/timebase.test.ts` →86 passed.

- [x] Add closed version-1 delivery/coverage request and result contracts; reject
      unknown versions/fields, invalid IDs, modes, ranges, handles and bounds.
- [x] Project existing source ranges via `resolveClipSourceRange`; union uses
      with clamped handles, preserve disjoint windows and deterministic ordering.
- [x] Expose typed copy-original/block reasons for opaque dependencies, locks,
      unsupported media and unavailable timing. Mark preview review-only and
      non-executable. Never mutate assets, Composition or edit history.
- [x] Add unit/application regressions and checkpoint this independently useful
      inspection owner. Keep D6B unchecked in TASKS.

## Task 2 — Shared review and execution eligibility

- [x] Bind application plan to baseline Collect ID, saved revision and hashes.
- [x] Add project-fenced CLI/API and review UI over the same owner, with quality
      disclosure, explicit accept and stale handling. No speculative Create.
- [x] Review source-clock/catalog conversion; keep opaque evidence on originals
      until a complete typed mapping preserves immutable provenance.

## Task 3 — Actual derivatives and portable v2 publication

- [x] Generate bounded, hash/probe-verified synthetic derivatives with explicit
      interval/offset lineage; preserve original project and v1 behavior.
- [x] Convert only the private captured package; preserve all Composition timing,
      locks, caption/transcript/source-map and reopen semantics.
- [x] Publish manifest v2 through the current destination/ZIP safety boundary;
      handle cancellation, stale sources/revision and disk failure atomically.
- [x] Compare decoded trimmed output to the original baseline; disclose offline
      quality and require explicit acceptance for review-only output.

## Task 4 — Review, full validation and PR

- [ ] One independent final review, regression-backed fixes and all available
      format/i18n/docs/lint/type/unit/build/CLI/interchange/browser/native gates.
- [ ] Real directory/ZIP relocation, long-GOP/handles/disjoint windows, frames,
      audio and timing/source hashes. Leave workstation evidence open honestly.
- [ ] Update TASKS/ROADMAP/validation and create a separate D6B PR; do not mark
      product completion while execution or parity acceptance remains absent.
