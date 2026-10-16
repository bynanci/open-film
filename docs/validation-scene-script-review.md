# Scene-script review validation

This slice starts from merged main
`b6225512b701f609170de57967c63fcaa344209f` (PR #15). It extends optional
LanguageProvider review to saved scene-planning text. Its
[contract](scene-script-review.md) distinguishes automated workflow evidence
from real model quality and workstation observations.

## Test-first evidence

Original session artifacts were recorded under
`/workspace/.cloud-onboarding/artifacts/openfilm-script-review-20261016/`.
That instance was replaced after its execution connection failed; those local
logs were not restored. Current verification is recorded separately under
`/workspace/.cloud-onboarding/artifacts/openfilm-script-review-resume-20261016/`.
The dated observations below do not substitute for the recovered candidate's
complete gates and published checks.

- Domain/catalog tests first failed on the missing scene target, store, migration
  and receipt contracts: 29 failures and one legacy-project control passed.
- Application tests first failed before the scene review service existed. The
  follow-up suite checks whitelisted input, text-only providers, exact consent,
  strict output, stale source, cancellation, saved-file failures and receipt
  recovery. Additional failures were reproduced for live-job reopening and
  invalid acceptance identifiers before their fixes.
- The real HTTP tests first failed because text-only readiness was unavailable
  and the script endpoint did not exist. Expanded coverage first failed on the
  missing CLI grammar, then passed all eight API/CLI cases.
- The actual compiled Story UI first lacked the connected review boundary;
  component regressions cover preparation, pending manual edits and receipt
  recovery before the final browser run.

## Initial published candidate and review correction

On 2026-10-16, candidate
`00087c1b7939c51bdbaa66090ba141f89d9bbf92` passed:

| Gate                                    | Observed result                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm format:check`                     | Passed                                                                               |
| `pnpm test:i18n`                        | Passed: 1,177 matching semantic keys, placeholders and localized error references    |
| `pnpm lint` / `pnpm typecheck`          | Passed                                                                               |
| `pnpm test`                             | Passed: 1,952 tests across 131 files                                                 |
| `pnpm build` / built CLI smoke          | Passed                                                                               |
| `pnpm test:interchange`                 | Passed: 18 official OpenTimelineIO 0.18.1 tests, source hashes/bounds and relocation |
| `pnpm test:native` / locked Cargo build | Passed: Linux formatting/clippy, seven Rust tests and native compile                 |
| Full `pnpm test:e2e`                    | Passed: 109 tests in 14.9 minutes                                                    |

The focused browser run passed **7/7 in 37.1 seconds**. It covers explicit
Accept/Skip, field isolation, stale evidence, delayed/lost acknowledgements,
history/reopening, three languages and pseudo-localization. Screenshots cover
en-US/en-XA at 1280×720, zh-TW at 1440×900 and ja-JP at 1920×1080. All 138 product
runtime files had identical before/after hashes during that run. The later
malformed/missing-project cleanup guard passed its own regressions, then the full
1,952-test run above. The complete 109-test browser run then passed with all 349
frozen source/configuration/test hashes unchanged. A concurrently added CLI-only
regression file was outside that browser runtime.

Two initial browser launches executed zero cases because the environment proxy
returned HTTP 403 for unused loopback ports. Merging `NO_PROXY`/`no_proxy` before
starting Node corrected the environment. The first completed run had six passes
and one delayed-acknowledgement failure: the test removed its network interception
before the real follow-up read settled. Keeping interception stable through the
real acknowledgement and follow-up UI made the focused case pass, then all seven
passed without sleeps, relaxed assertions or product changes. Original logs and
trace were recorded in that original instance's session artifacts.

Independent read-only reviews found and verified regressions for live-owner
reopening, invalid acceptance request IDs, loaded-project identity races, legacy
migration, opaque UI target collisions and external-file preservation. The final
application group passed **49/49 new cases** and **454/454 application cases**;
the core/catalog group passed **372 tests**, and the actual HTTP/CLI boundary
passed **eight cases**. The frozen source reviews had no unresolved correctness
findings. Published-head CI and review remain separate merge gates below.

GitHub's review of the initial published head subsequently found two CLI
correctness gaps: the new command omitted its abort signal and returned exit zero
for failed/cancelled jobs. Real CLI subprocesses with an explicitly preloaded
local provider reproduced both problems before the fix. The correction preserves
bare Job JSON on stdout, sends normal progress to stderr, forwards the existing
abort signal and returns 1 for failure or 130 for cancellation. All four cases
pass, including successful exit zero and persisted job/source state. SIGINT and
SIGTERM checks run on Linux; they do not certify real Windows console behavior.
The CLI-only correction received a renewed exact-head review, which identified
the additional concurrency/regeneration gaps below.

## Further correctness review

The review of `b58cb685a58a0d9a73ca83cb9a0c9694cd38fece` found:

- **P1: an ordinary second-process save could race acceptance's final read and
  atomic rename.** Three real-child regressions first failed: the competing save
  succeeded inside that seam, stale ordinary save succeeded, and stale close
  overwrote newer text. All manifest saves now compare their owner baseline and
  publish under the shared SQLite IMMEDIATE lock; nested acceptance retains its
  outer transaction. Additional cases verify retry after temporary contention
  and preservation after an owned transaction fails following file publication.
  The five writer regressions pass, with **581/581 application/catalog cases**
  across 33 files passing. Unrelated I/O failures retain the existing retryable
  application connection; only confirmed persistence conflicts suppress cleanup
  saves. The protocol coordinates OpenFilm writers, not arbitrary external file
  editors.
- **P2: restoring source text could leave explicit regeneration stuck on old
  stale evidence.** Five failures were reproduced before the fix. Explicit
  regeneration now archives only the old internal dedupe slot and creates a new
  pending record transactionally. Old IDs, status, text and audit remain intact;
  reads do not reactivate evidence, and accepted/skipped choices still dedupe.
  **24 focused catalog cases** pass, including actual concurrent child writers
  converging on one pending successor and rollback after an insertion failure.

These source changes require new complete gates, exact-head CI and review before
merge. The earlier 109-test browser run does not certify these later writers.

The first complete unit/integration run of
`0f79e9667a51c860ae4be9a68ee4710dc47f1427` passed **1,965 cases and failed one**.
The existing owned-service regression replaced `project.json` with a directory:
default stale-observer cleanup suppressed the persistence error, allowing a
successful shutdown acknowledgement. The correction keeps default safe project
close/switch behavior, while runtime shutdown explicitly requires a successful
workspace save. Export intent remains read-only. The original integration
assertions are retained; new strict-close cases first reproduced directory,
malformed, missing and previously detected conflicts as four failures, with six
controls passing. This regression must pass with the complete corrected-head
gates before merge.

After the correction, **10/10 strict-close cases**, **64/64 focused application
cases** and the **unchanged 7/7 owned-service integration cases** passed. In
particular, the original storage-failure case again receives `close-failed`,
exit 1 and no successful close acknowledgement. No old assertion was relaxed.

Candidate `aa6ae8fa3051281ff41bb4e583073f7f9bdfa251` subsequently passed
**1,976 unit/integration tests across 134 files**, format, i18n, lint, typecheck,
build, built CLI smoke, all 18 official OTIO cases and the Linux native checks
and locked build. Its complete browser run was deliberately interrupted after
56 completed cases when a further UI recovery deadlock was confirmed; that
interrupted run is not recorded as a complete browser pass.

## Reopening after an external save

An explicit `409 / story.planConflict` requires reopening the project, but the
panel previously retained a retry receipt that blocked project switching.
Two navigation regressions and three localized-rendering regressions first
failed, with 14 controls passing. Only that exact status/code combination now
removes the browser receipt, releases navigation and preserves localized reopen
guidance without a follow-up request. Network errors, 5xx, `jobs.busy` and
unclassified conflicts retain exact retry protection. Authoritative project-file
receipts and suggestion evidence are not removed or rewritten by this UI fix.

The corrected group passed **157/157 UI/App cases**, type checks and i18n
validation of **1,178 semantic keys**. A read-only independent review found no
remaining P1/P2 issue in that correction. The focused browser suite then passed
**8/8 in 38.2 seconds**, including a second real OpenFilm application writing
the same project: acceptance rejects with the exact conflict, navigation
recovers, reopening preserves external text, old evidence becomes stale and a
fresh suggestion can be explicitly accepted. Other Story fields, compositions,
clip edits/locks, media state and source files remain unchanged. All 138 runtime
and browser fixture/spec file hashes were identical before and after the run.
The conflict screenshot was checked in Traditional Chinese at 1440×900.

The focused run validates the frozen correction, not a substitute for the new
published head's complete regression and CI gates.

## Listing and concurrent project publication

Candidate `0be625b6a365c42ff0ee8f81e06ab62577c8ba9d` passed **1,986
unit/integration cases across 134 files** and all other local non-browser gates.
Its browser run was deliberately interrupted after **55 passed**, with one case
interrupted and 54 not run, when GitHub review identified a further P2 race:
listing checked the saved project before updating lifecycle state without the
shared lock, so a new suggestion from a second writer could be marked stale.

Two real-child regressions first reproduced the problem for both exact-scene
polling and broad Story history. The correction holds the shared project write
lock across saved verification, revision calculation, receipt reconciliation
and the bounded listing/stale updates. Reconciliation uses that same transaction
instead of a nested `BEGIN`. Receipt recovery rechecks actual database state,
so an owned or caller rollback cannot leave an authoritative in-memory memo.
Temporary contention reports retryable `jobs.busy`; unsaved, malformed, missing
and already-obsolete project views remain inspectable without lifecycle writes.

The new focused suite passed **13/13**, including both real-child races,
reopening fresh evidence, bounded field staling/pagination, retry after lock
contention and both receipt rollback paths. The two receipt paths also failed
before the correction. All **77/77 compatibility cases** across scene review,
project writer, strict close and the new list suite passed. These later source
changes again require complete corrected-head gates and review before merging.

## Restored publication, portability and consent corrections

GitHub's review of `ec7f013de8dfd1a39a95bb850867955b34c4c05f` found four
additional P2 issues even though both exact-head Verify runs succeeded
([PR run](https://github.com/bynanci/open-film/actions/runs/38895891621),
[push run](https://github.com/bynanci/open-film/actions/runs/38895885023)).
Its local browser run was intentionally stopped after 84 passed, with one
interrupted and 25 not run. It was not a complete local browser pass.

The fixes were reconstructed after the instance replacement. Production and
regression-file hashes match the independently reviewed pre-interruption
versions. New tests reproduced the issues before restoring production changes:

- **Failed mutations:** seven Story/film/import cases failed with three controls
  passing. Candidate publication now restores the complete pre-call authored
  draft on failure; import caches receive new libraries only after successful
  publication. Closing or retrying cannot silently save a rejected operation.
- **Moved managed sources:** four cases failed, with passive export passing.
  Workspace repair now couples catalog locations and changed manifest roots
  under the existing writer lock and loaded baseline check. Failed opening
  closes storage without autosave. The five cases use actual managed PNG media
  named `回憶 frame.png`, including partial prior repair, review/accept/reopen,
  passive export, a concurrent manifest change and failed publication cleanup.
- **Restored request identity:** three core/workspace/export cases failed with
  23 controls passing. Both suggestion IDs and acceptance request IDs must be
  unique across project receipts before opening can reconcile pending evidence.
  The real two-receipt fixture verifies unchanged bytes and pending rows on
  rejection, and recovery of both valid distinct receipts.
- **Remote disclosure:** four mounted-component cases failed because the visible
  consent text omitted the opaque Story and scene IDs actually sent. The three
  locale strings now disclose them before opt-in. Tests also verify no generation
  before consent, exact-descriptor consent and no automatic job when granting it.

Fresh focused results passed **15/15 application regressions**, **26/26
receipt/core cases** and **4/4 disclosure cases**. Typecheck and i18n validate
the actual component in en-US, zh-TW, ja-JP and pseudo-localization. The component
tests do not claim browser layout measurements for the remote consent state.
Independent read-only review found no new P1/P2 in the restored corrections.
Complete corrected-head regression and CI remain required before merge.

Complete published-candidate results are recorded in
[PR #16 checks](https://github.com/bynanci/open-film/pull/16/checks);
this dated local record does not substitute a targeted or earlier run for them.

## Regression and merge gates

The candidate must pass the existing format, i18n, lint, typecheck, unit and
integration, build, browser, official OTIO and native checks. New tests are
collected by those existing CI commands. The published commit must have green
CI and a fresh correctness review; findings that affect data preservation,
privacy, source binding or recovery are fixed before merge.

The browser tests use a task-discriminated deterministic local provider. They
exercise an actual saved Story and composition through generation, review,
acceptance, skipping, stale rejection and reopening. Language/layout checks
cover English, Traditional Chinese, Japanese and pseudo-localization at desktop
sizes. Fixture success is not a real LLM evaluation.

## Manual gates

No real LLM service, Windows startup/one-hour memory run, camera capture, GPU
measurement, installer or Resolve application import is certified by these
tests. Existing workstation evidence remains tracked separately in
[issue #7](https://github.com/bynanci/open-film/issues/7).
