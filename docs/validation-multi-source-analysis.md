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
  definitively failed/stale additions, delayed picker results and successful
  removals release only references no longer retained by the authoritative
  draft. Ambiguous responses retry the exact receipt and reconcile with a fresh
  draft read; access is conservatively retained if that read is also unavailable.
- The redesigned Import Panel presents the same draft in Standard and Expert
  modes, preserves explicit legacy import compatibility, supports cancellation,
  CJK and long pseudo-localized labels, and fences delayed reads, picker results
  and native listener registration across project changes or unmount.
- Review remediation disables the recursive legacy importer for shallow folders,
  reloads the latest draft after `import.draftStale`, keeps browser-upload cancel
  visible while closing is disabled, and rejects corrupted non-boolean recursion
  policies. Chromium exercises the actual IndexedDB backend across a reload;
  physical `FileSystemHandle` permission reopening remains a workstation gate.
- The final interaction pass reads persistent browser permissions in one batch,
  pages source cards in stable 100-item windows without changing the full draft,
  hides revision and host-path implementation detail from the Standard-mode
  hierarchy, reports typed rejection reasons, and preserves keyboard access,
  44px coarse-pointer targets and narrow-screen CJK wrapping. Project switches
  reset obsolete interaction locks, and delayed old-project responses cannot
  move the current page or clear current path input.

## Commands actually run

| Command                                                                            | Result                                                                                          |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                   | Passed; lockfile and supply-chain policy verified.                                              |
| `OPENFILM_OTIO_PYTHON=/tmp/openfilm-otio-venv/bin/python pnpm test` before changes | Passed: 280 files, 3,834 tests.                                                                 |
| Focused core/catalog/application tests                                             | Passed: 8 files, 68 tests; old-version fixtures remove later tables before declaring v2-v5.     |
| M1 application/HTTP/component/browser/native-contract tests                        | Passed: 7 focused files, 49 tests after UI/UX and lifecycle remediation.                        |
| `OPENFILM_OTIO_PYTHON=/tmp/openfilm-otio-venv/bin/python pnpm test` after M1       | Passed: 287 files, 3,888 tests in 353.40 seconds.                                               |
| `pnpm format:check`                                                                | Passed; all tracked files match Prettier formatting.                                            |
| `pnpm lint`                                                                        | Passed with zero warnings.                                                                      |
| `pnpm typecheck`                                                                   | Passed after M1 implementation.                                                                 |
| `pnpm test:i18n`                                                                   | Passed: 2,337 semantic keys aligned.                                                            |
| `pnpm test:docs-i18n`                                                              | Passed: 9 README locales and 113 English reference mirrors.                                     |
| `pnpm build`                                                                       | Passed: 274 modules transformed; the existing large-chunk advisory remains.                     |
| Focused M1 Playwright regression                                                   | Passed: 4 tests at 375px, including disclosure, 44px touch targets and source-name containment. |
| `OPENFILM_OTIO_PYTHON=/tmp/openfilm-otio-venv/bin/python pnpm test:e2e`            | Passed: 234 Playwright tests in 18.8 minutes from the final files.                              |
| `OPENFILM_OTIO_PYTHON=/tmp/openfilm-otio-venv/bin/python pnpm test:interchange`    | Passed: 18 tests, source hash/bounds and relocation gates; real Resolve import unverified.      |

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

Follow-up review found that stale reload shared a token with the native drop
listener and that a mutation completing after close/project switch could clean
access against an older local draft. Draft-read sequencing is now separate from
component/project lifecycle fencing. Add, remove and recursion mutations retry
an ambiguous transport result once with the identical request ID and body;
successful retries and fresh reconciliation reads drive cleanup from the
authoritative draft, while unavailable reconciliation keeps access intact. Tests
cover stale-reload-then-drop, add/remove completion after unmount, lost add/remove
acknowledgements and unavailable reconciliation. A second independent review
reported no Critical or Important findings before the final full runs above.

The synthetic 10,000-source component benchmark reduced rendered host nodes from
120,045 to 1,253, initial render time from 630ms to 31ms, and measured process
heap from 382 MiB to 43 MiB while keeping every source reachable through pages.
Manual Playwright probes at 375, 640 and 1280 pixels found no page or panel
horizontal overflow. Axe WCAG A/AA scans in light and dark themes reported no
violations; physical assistive-technology and high-DPI checks remain manual.

The first complete browser pass after progressive disclosure passed 233 of 234
tests. The one timeout showed that the shared legacy-folder helper treated
always-visible summary counters as proof that the source draft had loaded, so it
could miss an existing source and construct an intentionally incompatible
two-folder draft. The helper now waits for the mutually exclusive loaded
empty/source section before clearing cards. The unchanged regression passed in
8.0 seconds alone and then in 7.0 seconds within the final 234-test green run;
no timeout or product assertion was weakened.

## Open gates

M2–M7 remain incomplete. M1 does not claim streaming discovery, manifest sealing,
common analysis, 10,000-candidate backpressure, GPX, remote sample-provider,
external-drive or private-media verification. `pnpm test:native` was not run
because this environment has neither `cargo` nor `rustc`; the authored Rust tests
therefore remain unexecuted here. Windows/macOS/Linux picker, permission-reopen,
external-drive and real Resolve checks remain workstation gates.
