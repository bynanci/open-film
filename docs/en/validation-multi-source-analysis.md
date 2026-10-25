# Multi-Source Analysis Validation

Date: 2026-10-25  
Baseline: `61a46596d7a2cd17e1c993b2b6fd3f31c5ed807d`  
Current slice: M0 contracts/catalog compatibility and M1 source selection

## Implemented evidence

- Catalog schema v6 creates the source, occurrence, membership, content,
  manifest, run/result and review-decision tables in one additive migration.
- A policy registry classifies every durable SQLite table. The regression opens
  `sqlite_master` and fails when a table has no policy.
- Portable catalog projection retains selected asset/source/content evidence,
  removes unselected occurrences and identities, deletes local jobs/caches, and
  VACUUMs free pages so removed private values are not recoverable from output.
- `upgradeCatalogSnapshot` validates the recorded old schema, migrates a private
  copy and leaves the original bytes unchanged.
- A generated schema-v5 Named Version fixture can be inspected and restored under
  v6; its stored catalog hash remains unchanged and the automatic pre-restore
  checkpoint uses schema v6.
- Core lifecycle regressions prove retry/terminal behavior for ImportBatch,
  AnalysisRun and JobAttempt.
- A project-private, revisioned source draft accumulates repeated files and
  folders without creating assets or jobs. Mutations carry project, base
  revision and request identity; stale, duplicate and foreign mutations are
  fenced through one application service shared by Desktop and HTTP.
- Tauri exposes multi-folder selection and bounded typed drop classification.
  Rust coverage classifies regular files, folders, missing entries and symlinks
  with `symlink_metadata`, while the TypeScript bridge never treats a rejected
  path as a source.
- Browser `FileSystemHandle` values use IndexedDB structured cloning and
  permission checks. Ordinary `File` values stay in a project-scoped in-memory
  registry and reopen as `needs-reselection`; opaque references, not handles or
  bytes, enter the private draft.
- Browser choices are bounded before access retention. Persistent handles are
  validated and saved or removed in one IndexedDB transaction per batch, while
  failed/stale additions, delayed picker results and successful removals release
  only references no longer retained by the accepted draft.
- The redesigned Import Panel presents the same draft in Standard and Expert
  modes, preserves explicit legacy import compatibility, supports cancellation,
  CJK and long pseudo-localized labels, and fences delayed reads, picker results
  and native listener registration across project changes or unmount.
- Review remediation disables the recursive legacy importer for shallow folders,
  reloads the latest draft after `import.draftStale`, keeps browser-upload cancel
  visible while closing is disabled, and rejects corrupted non-boolean recursion
  policies. Chromium exercises the actual IndexedDB backend across a reload;
  physical `FileSystemHandle` permission reopening remains a workstation gate.

## Commands actually run

| Command                                                                            | Result                                                                                                 |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile`                                                   | Passed; lockfile and supply-chain policy verified.                                                     |
| `OPENFILM_OTIO_PYTHON=/tmp/openfilm-otio-venv/bin/python pnpm test` before changes | Passed: 280 files, 3,834 tests.                                                                        |
| Focused core/catalog/application tests                                             | Passed: 8 files, 68 tests; old-version fixtures remove later tables before declaring v2-v5.            |
| M1 application/HTTP/component/browser/native-contract tests                        | Passed: 6 files, 34 tests after review remediation.                                                    |
| `OPENFILM_OTIO_PYTHON=/tmp/openfilm-otio-venv/bin/python pnpm test` after M1       | Passed: 287 files, 3,876 tests in 350.94 seconds.                                                      |
| `pnpm format:check`                                                                | Passed; all tracked files match Prettier formatting.                                                   |
| `pnpm lint`                                                                        | Passed with zero warnings.                                                                             |
| `pnpm typecheck`                                                                   | Passed after M1 implementation.                                                                        |
| `pnpm test:i18n`                                                                   | Passed: 2,326 semantic keys aligned.                                                                   |
| `pnpm test:docs-i18n`                                                              | Passed: 9 README locales and 113 English reference mirrors.                                            |
| `pnpm build`                                                                       | Passed: 274 modules transformed; the existing large-chunk advisory remains.                            |
| `OPENFILM_OTIO_PYTHON=/tmp/openfilm-otio-venv/bin/python pnpm test:e2e`            | Passed: 233 Playwright tests in 18.8 minutes, including real IndexedDB reopen and upload cancellation. |
| `OPENFILM_OTIO_PYTHON=/tmp/openfilm-otio-venv/bin/python pnpm test:interchange`    | Passed: 18 tests, source hash/bounds and relocation gates; real Resolve import unverified.             |

The first unqualified baseline run had one environment-only failure because
system Python lacked `opentimelineio`. The repository's existing pinned
OpenTimelineIO 0.18.1 interpreter passed that exact test, followed by the complete
green baseline above. No assertion was skipped or weakened.

The first M1 full-browser run exposed four real compatibility/layout failures:
pseudo-locale footer overflow, one test still driving the retired folder entry,
and two repeated legacy imports retaining an earlier draft source. The UI now
wraps expanded labels, the PhotoDepth flow uses explicit add/continue controls,
and the legacy single-folder test helper clears only its consumed compatibility
selection. All four focused reruns passed, followed by the complete 231-test
historical green run.

Independent code review then found five lifecycle/semantic defects and two test
coverage gaps. Focused failing regressions reproduced shallow-folder recursion,
hidden upload cancellation, delayed picker completion, stale revisions, orphaned
browser access and corrupted stored recursion. The fixes add generation fencing,
draft reload, bounded transactional access storage and cleanup. The final full
Vitest and Playwright runs above use the corrected files.

## Open gates

M2–M7 remain incomplete. M1 does not claim streaming discovery, manifest sealing,
common analysis, 10,000-candidate backpressure, GPX, remote sample-provider,
external-drive or private-media verification. `pnpm test:native` was not run
because this environment has neither `cargo` nor `rustc`; the authored Rust tests
therefore remain unexecuted here. Windows/macOS/Linux picker, permission-reopen,
external-drive and real Resolve checks remain workstation gates.
