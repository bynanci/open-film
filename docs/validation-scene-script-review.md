# Scene-script review validation

This slice starts from merged main
`b6225512b701f609170de57967c63fcaa344209f` (PR #15). It extends optional
LanguageProvider review to saved scene-planning text. Its
[contract](scene-script-review.md) distinguishes automated workflow evidence
from real model quality and workstation observations.

## Test-first evidence

Session artifacts are under
`/workspace/.cloud-onboarding/artifacts/openfilm-script-review-20261016/`.

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
trace remain in the session artifacts.

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
The CLI-only correction requires its own exact-head CI and renewed review.

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
