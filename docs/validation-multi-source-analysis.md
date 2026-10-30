# Multi-Source Analysis Validation

Date: 2026-10-30
Implementation base: `e77e3e9e5e8ce7986b177a192f203dfd5198e069` (`origin/main`)
Current slice: M0–M6 and review fixes implemented; local automated M7 gates passed, workstation gates open

Local environment: Debian 13, Node 24.19.0, pnpm 11.19.0, FFmpeg 7.1.5,
Chromium 151.0.7922.173, and the isolated pinned OpenTimelineIO 0.18.1 interpreter.

## Implemented evidence

- Catalog schema v6 creates the source, occurrence, membership, content,
  manifest, run/result and review-decision tables in one additive migration.
- A policy registry classifies every durable SQLite table. The regression opens
  `sqlite_master` and fails when a table has no policy.
- Portable catalog projection retains selected asset/source/content evidence,
  removes unselected occurrences and identities, deletes local jobs/caches,
  rewrites logical/relative locators and rebuilds every retained v6 JSON payload
  from explicit semantic columns before VACUUM. Manifest and review strings use
  dedicated typed serializers. Event labels, travel facts and visual samples
  retain only their producer-validated fields; uncontracted strings, unknown
  fields, locators and credentials remain omitted, so removed private bytes are
  not recoverable.
- `upgradeCatalogSnapshot` validates the recorded old schema, migrates a private
  copy and leaves the original bytes unchanged.
- Hash-pinned SQLite and complete Named Version fixtures produced by the actual
  schema-v5 application at baseline `61a4659` can be inspected, diffed and
  restored under v6. Historical project/record/index/catalog bytes stay unchanged
  and the automatic pre-restore checkpoint uses schema v6. DDL comparison only
  normalizes SQLite ASCII whitespace and also compares column, foreign-key and
  index PRAGMAs, including the NBSP structural counterexample.
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
- Independent-review remediation aligns the picker and compact source-draft
  limits at 10,000 selections / 4 MiB, proves both the individual-file and
  fallback-folder 10,000 boundary, indexes persistent browser records by project,
  clears failed IndexedDB opens for retry, closes late blocked connections and
  invalidates connections on version changes. Candidate-key indexing replaces
  quadratic handle scans; permission queries reuse duplicate references and run
  with at most 16 workers. Only the visible 100 persistent sources are refreshed,
  while session-only files needed by the compatibility action remain checked.
  A rejected recursion mutation restores the checkbox from authoritative state.
- Final blocker closure prunes a near-limit 512-receipt draft with one large-body
  serialization, loads availability/removal handles by requested keys, caps
  identity comparisons and atomically rejects an unresolved 33rd same-name
  handle instead of silently duplicating it. Portable projection preserves typed
  Expected/Verified Manifest and ReviewDecision semantics, failure codes and
  numeric analysis evidence while adversarial generic paths, arrays, signed URLs,
  opaque tokens and authorization strings are absent after production VACUUM.

## M2–M6 implementation evidence

- M2 streams adapter-v2 discovery through bounded workers and pages persisted
  occurrence/membership records. The v1 adapter is wrapped without changing its
  public contract. Symlink, recursive-scope, path-containment, cancel,
  backpressure and 10,000-candidate cases are covered. Sealing uses project
  private staging, full SHA-256 identity, immutable asset content versions and
  Expected/Verified Manifests; restart, source-change, partial, retry and orphan
  recovery are exercised with synthetic sources.
- M3 derives common event/duplicate results only from the exact verified
  manifest. Attempt owner/generation tokens fence late completions; cancel and
  retry reuse the immutable inputs while producing a new attempt. Desktop, HTTP
  and CLI use the same application services, with legacy import/analyze routes
  retained.
- M4 `travel-v1` accepts a bounded GPX track-point subset, preserves track
  segment boundaries and source hash, and stores explicit manual clock offsets,
  time zones and asset assignments in the run fingerprint. Unknown/conflicting
  time/location evidence stays reviewable; matching does not interpolate over
  route gaps.
- M5 extracts representative image/video frames with the real FFmpeg adapter.
  Provider payloads are limited to an encoded sample and bounded metadata;
  remote invocation requires provider-specific consent. Durable evidence stores
  source/frame hashes, time range, labels and receipt, never frame bytes or a
  source URI. Missing provider/sample conditions remain unknown/manual review.
- M6 review search and preview are non-mutating. Accepted typed decisions are
  immutable and bind result, operation, manifest and optional story fingerprints.
  The catalog and portable serializer verify the operation hash, malformed
  split fields fail closed, stale decisions are recorded as conflicts, and
  StoryGraph adoption occurs only on explicit acceptance with reopen recovery.
- Added regressions use generated synthetic media only. No user photographs,
  private chat, personal identifiers or workstation media are committed or
  attached to test artifacts.

## Commands actually run

| Command                                                                                                     | Result                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                            | Passed; lockfile and supply-chain policy verified.                                                                        |
| `OPENFILM_OTIO_PYTHON=/tmp/openfilm-otio-venv/bin/python pnpm test` before changes                          | Passed: 280 files, 3,834 tests.                                                                                           |
| Focused core/catalog/application tests                                                                      | Passed: 8 files, 68 tests; old-version fixtures remove later tables before declaring v2-v5.                               |
| M1 application/HTTP/component/browser/native-contract tests                                                 | Passed: 7 focused files, 49 tests after UI/UX and lifecycle remediation.                                                  |
| Independent-review focused catalog/application/UI regressions                                               | Passed; final privacy/access suite: 2 files, 24 tests, plus authentic full-v5 and 4 MiB regressions.                      |
| `OPENFILM_OTIO_PYTHON=/tmp/openfilm-otio-venv/bin/python pnpm test` at `e49ae68`                            | Passed: 287 files, 3,904 tests in 355.25 seconds.                                                                         |
| `pnpm format:check`                                                                                         | Passed; all tracked files match Prettier formatting.                                                                      |
| `pnpm lint`                                                                                                 | Passed with zero warnings.                                                                                                |
| `pnpm typecheck`                                                                                            | Passed after M1 implementation.                                                                                           |
| `pnpm test:i18n`                                                                                            | Passed: 2,337 semantic keys aligned.                                                                                      |
| `pnpm test:docs-i18n`                                                                                       | Passed: 9 README locales and 113 English reference mirrors.                                                               |
| `pnpm build`                                                                                                | Passed: 274 modules transformed; the existing large-chunk advisory remains.                                               |
| Focused M1 Playwright regression                                                                            | Passed: 4 tests at 375px, including disclosure, 44px touch targets and source-name containment.                           |
| `OPENFILM_CHROMIUM=/usr/bin/chromium OPENFILM_OTIO_PYTHON=/tmp/openfilm-otio-venv/bin/python pnpm test:e2e` | Passed: 234/234 Playwright tests in 20.0 minutes at `e49ae68`.                                                            |
| `OPENFILM_OTIO_PYTHON=/tmp/openfilm-otio-venv/bin/python pnpm test:interchange`                             | Passed: 18 tests, source hash/bounds and relocation gates; real Resolve import unverified.                                |
| Current focused multi-source regressions                                                                    | Passed: 7 files, 82 tests across application, catalog, HTTP, CLI, picker and Import Panel.                                |
| `OPENFILM_OTIO_PYTHON=/tmp/openfilm-otio-venv/bin/python pnpm test`                                         | Passed: 305 files, 4,350 tests in 369.98 seconds.                                                                         |
| `pnpm format:check`                                                                                         | Passed after M0–M6 changes.                                                                                               |
| `pnpm lint`                                                                                                 | Passed with zero warnings after M0–M6 changes.                                                                            |
| `pnpm typecheck`                                                                                            | Passed, including Vue 3 TypeScript.                                                                                       |
| `pnpm test:i18n`                                                                                            | Passed: 2,543 semantic keys aligned across en-US, zh-TW and ja-JP.                                                        |
| `pnpm test:docs-i18n`                                                                                       | Passed after syncing 119 English reference mirrors.                                                                       |
| `pnpm build`                                                                                                | Passed: 298 modules transformed; browser no longer bundles the Node-only application barrel; chunk-size advisory remains. |
| `node scripts/smoke-built-cli.mjs`                                                                          | Passed: synthetic import, Story, FFmpeg waveform/scenes, CJK title, export/reopen and hash immutability.                  |
| `OPENFILM_OTIO_PYTHON=/tmp/openfilm-otio-venv/bin/python pnpm test:interchange`                             | Passed: OTIO 0.18.1 read/write/read, 18 tests, hash/bounds and relocation; Resolve import unverified.                     |
| `OPENFILM_CHROMIUM=/usr/bin/chromium OPENFILM_OTIO_PYTHON=/tmp/openfilm-otio-venv/bin/python pnpm test:e2e` | Passed: 278/278 Chromium tests in 21.0 minutes; synthetic-media rendering and project recovery exercised.                 |
| `OPENFILM_OTIO_PYTHON=/tmp/openfilm-otio-venv/bin/python pnpm test` at final working-tree state             | Passed: 305 files, 4,350 tests in 367.84 seconds after the browser import-boundary fix.                                   |

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

A final adversarial review then demonstrated that key-name redaction alone could
retain a private value under generic analysis fields, and that accepting a source
beyond a bounded same-name identity window could create a duplicate. The final
serializer therefore has no arbitrary-string path for extensible M0/M1 evidence;
later milestones must add each semantic string together with its producer
contract and redaction regression. Browser identity ambiguity now fails before
the IndexedDB write, including same-call and reopened-store cases. The final
independent review of `e49ae6883007464407d459d1e3fa3c5d4788aff5` reported zero
Critical, Important or Minor findings. Exact-head Vitest and Playwright runs are
the green results above; no assertion was skipped or weakened.

The synthetic 10,000-source component benchmark reduced rendered host nodes from
120,045 to 1,253, initial render time from 630ms to 31ms, and measured process
heap from 382 MiB to 43 MiB while keeping every source reachable through pages.
Manual Playwright probes at 375, 640 and 1280 pixels found no page or panel
horizontal overflow. Axe WCAG A/AA scans in light and dark themes reported no
violations; physical assistive-technology and high-DPI checks remain manual.

The full 10,000-file picker and 10,000-member fallback-folder regression
completed in 19 ms in this container; compact persistence and reopen completed in
74 ms. These are evidence timings rather than workstation SLAs. The same tests
assert the exact 10,000 boundary, pre-retention rejection above the byte/count
limits, and reachability of the last retained file.

The first complete browser pass after progressive disclosure passed 233 of 234
tests. The one timeout showed that the shared legacy-folder helper treated
always-visible summary counters as proof that the source draft had loaded, so it
could miss an existing source and construct an intentionally incompatible
two-folder draft. The helper now waits for the mutually exclusive loaded
empty/source section before clearing cards. The unchanged regression passed in
8.0 seconds alone and then in 7.0 seconds within the final 234-test green run;
no timeout or product assertion was weakened.

## M6 review and recovery optimisation

The Task 9 review verified five defects against the preceding uncommitted
candidate: changed correction/time/story inputs retained old previews; earlier
search responses could overwrite a newer query; a lost acceptance response used
a new request ID on retry and implicitly superseded an unrelated conflict;
custom StoryGraph asset-node IDs produced dangling adoption edges; and saved
adoption did not refresh the workspace Storyboard.

Seven changed-input/search regressions failed before the UI fix. Lost-response,
remount-recovery, durable-storage failure and unrelated-supersession regressions
failed before the acceptance fix. The real application reproduced the dangling
edge, and the real Chromium workflow reproduced a saved beat missing from the
Storyboard. These assertions were retained through the fixes.

The UI now binds each preview to its exact form, orders searches by generation
and query/page, clears selection immediately on search, and shows loading and
zero-result states. A bounded project-private local receipt is verified before
the first acceptance send, retained across ambiguous responses, and reused only
after explicit retry. Malformed/foreign receipts are not sent or silently
deleted. Forms remain frozen while a receipt is unresolved. Supersession is an
explicit choice. Adoption reuses existing graph node IDs, and its acknowledged
workspace refresh is fenced by project, generation and mutation version.

Current focused evidence: 3 Vitest files / 66 tests; 5 Chromium tests in 30.6
seconds; typecheck and lint passed. Browser coverage uses actual uploaded
synthetic PNG/MP4 bytes, verifies four decoded frame receipts including three
video timestamps and hashes, preserves original files, exercises en-US/zh-TW/
ja-JP, and recovers a real server commit after its response is deliberately
lost. The recovered request is byte-for-byte equivalent as JSON and produces
one decision. A 375px keyboard retry remains usable without horizontal overflow.
No runtime-speed claim is made from these correctness/interaction regressions.

The native Python transport/archive tests also passed (3 tests). Rust, GTK3 and
WebKit 4.1 development packages and sudo are unavailable, so the complete
`pnpm test:native` gate remains unexecuted. The preceding full-suite rows describe
the baseline; the final-candidate table below records the completed fix-pass gates.

### Independent review and correctness fixes

The independent read-only reviewer reported eight Important findings and no
Critical or Minor findings. All eight were accepted into one test-first fix pass:

- Browser staging now includes an exact discovery fingerprint, validated on
  reusable listings, upload publication and sealing. Same-size source replacement
  and a rescan during upload cannot publish the old bytes as a new discovery.
- Travel input rejects uncontracted keys at all six nesting levels. Portable
  catalogs reconstruct allowed fields before validation; a raw SQLite sentinel
  regression proves unknown private fields are absent from the package bytes.
- Source-analysis cancellation bypasses the long mutation queue after the usual
  host/origin/session checks. Both the run action and Activity action resolve to
  the same owned cancellation. A disconnected native scan observes response.close,
  marks its summary cancelled, and leaves no completed readiness receipt.
- Representative sampling streams one source into a private temporary snapshot,
  verifies the full sealed SHA-256 before decoding, extracts at most three bounded
  frames from those stable bytes, and cleans the snapshot in finally. Mismatched
  source bytes fail without provider disclosure. This adds transient disk I/O for
  one source; it is not a measured rendering-speed improvement.
- The final result write rechecks signal, owner/generation, run state and current
  input fingerprint inside the catalog write transaction. A displaced worker
  cannot finalize the new owner's attempt. New jobs retain the existing process
  owner contract so a concurrent status reader does not reclaim a live or
  unverifiable owner; private receipts predating process ownership retain the
  documented legacy interruption recovery behavior.
- Search derives deterministic merged groups and reviewed annotations from
  immutable decisions. Accepted evidence remains adoptable; rejected evidence
  stays protected. Preview fingerprints include applied decision lineage, so a
  later accepted decision invalidates an older preview even when result status
  remains accepted. Source evidence is not rewritten.
- Split ranges must refer to the selected result's timed source lineage, remain
  non-overlapping and fit actual duration. Desktop derives the second range's
  end from that duration, supports multiple selected results for adoption, and
  preserves existing Composition timing.

Focused closure currently passes 12 files / 143 tests and six real browser flows;
two additional ownership/lineage regressions passed with the 27-test application
suite. Final full-suite results are recorded below.

The final focused browser rerun passed 6/6 in 35.2 seconds. It now accepts a
correction and then adopts that accepted observation together with another
result in all three locales, verifies real source-duration split ranges against
the saved decision, keeps an existing saved Composition identical, recovers a
lost committed response after reload, checks narrow keyboard access, and proves
ordered search/empty-state behavior. Run and Activity cancellation plus native
scan disconnect pass the 12-test HTTP suite. Typecheck and lint pass on this
candidate. The full Vitest and repository-wide Chromium runs below use these fixes.

| Final-candidate gate                                                            | Observed result                                                                                                                                    |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`                                                             | Passed after the final source and validation-document updates.                                                                                     |
| `pnpm lint` / `pnpm typecheck`                                                  | Passed, zero lint warnings; TypeScript and Vue TypeScript validated.                                                                               |
| `pnpm test:i18n`                                                                | Passed: 2,558 aligned semantic keys and placeholders.                                                                                              |
| `pnpm test:docs-i18n`                                                           | Passed: 9 README locales and 119 English mirrors.                                                                                                  |
| `OPENFILM_OTIO_PYTHON=/tmp/openfilm-otio-venv/bin/python pnpm test`             | Passed: 306 files, 4,397 tests, 378.11 seconds.                                                                                                    |
| `pnpm build`                                                                    | Passed: 299 browser modules; existing >500 kB chunk advisory remains.                                                                              |
| `node scripts/smoke-built-cli.mjs`                                              | Passed: real synthetic import, FFmpeg waveform/scenes, playable MP4, CJK title, export/reopen and original hashes. Protocol fixture is not ASR QA. |
| `OPENFILM_OTIO_PYTHON=/tmp/openfilm-otio-venv/bin/python pnpm test:interchange` | Passed: 18 tests, OTIO 0.18.1 read/write/read, source hashes/bounds and relocation. Resolve import unverified.                                     |
| Full Chromium E2E                                                               | Passed: 284/284 tests in 21.6 minutes after the final fix pass.                                                                                    |
| Native Python transport/archive tests                                           | Passed: 3 tests. Local Rust/Tauri is unexecuted; candidate hosted native-shell evidence belongs to the PR checks.                                  |

Review rulings: unavailable Windows/macOS/native/Resolve evidence remains open;
root owns fresh full-suite verification; split/correction remains reviewed source
annotation plus adoption; timezone inference/interpolation remains outside the
manual travel contract; large duplicate/travel latency has no measured speed
claim; direct-service publication is protected by owner/input fences; parser
replacement and cosmetic refactoring have no reproduced defect; the historical
v5 migration and its hash-pinned checks remain required. These choices preserve
the approved scope. Their costs are the open platform evidence, unmeasured worst
case latency, and the need for explicit timeline edits or a new regression when
a genuinely new behavior is requested.

## Open gates

M2–M6 implementation is complete for the accepted scope. M7 workstation evidence
remains open: this runner has no `cargo`/`rustc`, and no physical Windows/macOS
workstations. Therefore local `pnpm test:native`, native Tauri packaging, Windows/macOS
picker and browser permission reopening, external-drive stress, Safari/Firefox
and physical assistive-technology/high-DPI checks were not run. The interchange
gate proves OTIO read/write/read, source hashes/bounds and relocation, but real
DaVinci Resolve import remains unverified. No hardware, Resolve, private-media,
remote-provider service or 4K workstation QA is claimed.

Close the remaining gates using synthetic fixtures and the existing
[workstation QA guide](workstation-qa.md), [native installer guide](native-installer.md)
and [Resolve QA guide](resolve-workstation-qa.md). Evidence stays local until it is
reviewed for publication.

| Open gate                             | Required workstation evidence                                                                                                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rust/Tauri                            | Install the platform prerequisites, run `pnpm test:native` and the locked native build; record exact toolchain, FFmpeg and source revision.                                   |
| Windows/macOS pickers and permissions | Add/cancel/repeat/drop synthetic files and folders; reopen persistent handles, revoke permission, reselect expired files, and verify symlink/reparse handling.                |
| Safari/Firefox and accessibility      | Exercise fallback file/folder selection, keyboard review/retry, CJK layout, screen reader announcements and high-DPI reflow in the actual supported browsers.                 |
| External-drive and stress             | Scan/stage synthetic media, disconnect and reconnect the drive, cancel/retry and reopen; verify manifest/source hashes and partial-scope disclosure.                          |
| Resolve                               | Follow the existing import/relink checklist with the generated interchange package and retain actual NLE/version evidence; metadata-only effects require explicit recreation. |
