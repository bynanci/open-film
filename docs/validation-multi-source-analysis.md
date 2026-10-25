# Multi-Source Analysis Validation

Date: 2026-10-25  
Baseline: `61a46596d7a2cd17e1c993b2b6fd3f31c5ed807d`  
Current slice: M0 contracts and catalog compatibility

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

## Commands actually run

| Command                                                                            | Result                                                                                      |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                   | Passed; lockfile and supply-chain policy verified.                                          |
| `OPENFILM_OTIO_PYTHON=/tmp/openfilm-otio-venv/bin/python pnpm test` before changes | Passed: 280 files, 3,834 tests.                                                             |
| Focused core/catalog/application tests                                             | Passed: 8 files, 68 tests; old-version fixtures remove later tables before declaring v2-v5. |
| `OPENFILM_OTIO_PYTHON=/tmp/openfilm-otio-venv/bin/python pnpm test` after M0       | Passed: 281 files, 3,842 tests in 350.01 seconds.                                           |
| `pnpm format:check`                                                                | Passed; all tracked files match Prettier formatting.                                        |
| `pnpm lint`                                                                        | Passed with zero warnings.                                                                  |
| `pnpm typecheck`                                                                   | Passed after M0 implementation.                                                             |
| `pnpm test:i18n`                                                                   | Passed: 2,305 semantic keys aligned.                                                        |
| `pnpm test:docs-i18n`                                                              | Passed: 9 README locales and 113 English reference mirrors.                                 |
| `pnpm build`                                                                       | Passed: 272 modules transformed; the existing large-chunk advisory remains.                 |
| `OPENFILM_OTIO_PYTHON=/tmp/openfilm-otio-venv/bin/python pnpm test:e2e`            | Passed: 230 Playwright tests in 18.7 minutes.                                               |
| `OPENFILM_OTIO_PYTHON=/tmp/openfilm-otio-venv/bin/python pnpm test:interchange`    | Passed: 18 tests, source hash/bounds and relocation gates; real Resolve import unverified.  |

The first unqualified baseline run had one environment-only failure because
system Python lacked `opentimelineio`. The repository's existing pinned
OpenTimelineIO 0.18.1 interpreter passed that exact test, followed by the complete
green baseline above. No assertion was skipped or weakened.

## Open gates

M1–M7 remain incomplete. No native picker, browser handle persistence,
10,000-source stress, GPX, remote sample-provider, workstation OS, external-drive
or private-media claim is made by M0. `pnpm test:native` was not run because this
environment has neither `cargo` nor `rustc`; Windows/macOS/Linux picker and real
Resolve checks remain workstation gates.
