# Native Workstation Measurement Implementation Plan

> **For agentic workers:** Use executing-plans for the runner and independent agents for checkpoint/collector/fixture slices.

**Goal:** Capture honest first-open and one-hour native memory evidence on a workstation without replacing hardware QA with cloud browser results.

**Architecture:** Opt-in fixed-field Tauri checkpoints identify usable UI milestones. A separate local runner owns native/service processes, records platform-specific memory and preserves raw evidence. Existing QA gate schema stays unchanged.

**Tech Stack:** Existing TypeScript/Node, Rust/Tauri, OS process interfaces; no new dependencies.

**Spec:** [native measurement contract](../../native-performance.md).

## Constraints and review focus

- No remote data, cache clearing, user-data deletion or automatic application termination.
- No mixed clock origins, silent incomplete totals or claims of leak freedom.
- PID reuse, service startup failure/cancellation, hidden/stale views, output collisions and generated-fixture identity require regression coverage.
- Linux headless execution is a negative/smoke check; real workstation execution remains manual.

## Deliverables

- [x] Fixed-field Rust sink and guarded App/Edit checkpoints; disabled/failed/stale tests and native static checks.
- [x] `process-memory.ts`: bounded Linux/Windows/macOS rooted collection, identity/coverage tests and live Linux process smoke.
- [x] `create-fixture.ts`: fresh generated 2,000-asset/500-clip project with initial hashes and reopen/collision tests.
- [x] `run.ts` / `record.ts`: explicit config, owned service, clocks, partial evidence, interruption, no-overwrite and cleanup tests.
- [ ] Complete applicable regression, independent correctness review, documented workstation procedure and PR publication.
- [ ] Real workstation repeated first-open and one-hour measurement. Requires workstation access/operator execution; not satisfied by CI.
