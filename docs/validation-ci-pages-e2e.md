# Website gate and isolated E2E evidence

Date:2026-10-30. Branch:`codex/ci-pages-e2e`.
Initial base:`1798663372fc0b2073c1561b589e176061160bb7` (Windows PR69),
stacked on main8de63ae. Stable release remainsv0.4.0.
Status: reviewed source and full exact-head hosted gates pass. PR71 merged into
Windows PR69 as82520c7, with exactly the873ef8e Git tree. Final integrated/main
Verify and actual Pages outcomes are recorded on
[PR69](https://github.com/bynanci/open-film/pull/69); main merge requires green gates.

## Why main showed failed

| Candidate / run                 | Actual result and cause                                                                       | Follow-up                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| main8de63ae / Verify41041116586 | Success.                                                                                      | No failing product gate inferred.                                                               |
| main8de63ae / Pages41041116556  | Failure: two architecture links target an internal design excluded by VitePress `srcExclude`. | Fix both links to repository source; run real website build before merge.                       |
| main9c392b7 / Pages41018530760  | Build-documentation step failed.                                                              | Do not reinterpret old runs as successful. Current full website build is the superseding proof. |
| main132cac1 / Verify41027075240 | `pnpm format:check` failed; native passed.                                                    | Formatting/locales were reconciled in PR65 and subsequent main Verify passes.                   |
| main5160d8f / Verify41037490739 | Cancelled after newer main.                                                                   | Superseded run, not proof of a product assertion failure.                                       |

PR verification previously omitted `npm ci && npm run build` in `docs`, while
Pages ran only after main updates. That verification gap is corrected with a
mandatory `docs-site` job. Dead-link checking stays enabled; the excluded design
tree is not added to the public website.

## E2E design and retained gates

PR70 heavy jobs took45m35s/46m26s, including30.0m of Chromium in the PR run.
Media and E2E were serial. Fixed4310/1420 ports and shared mutable project state
make raising browser workers unsafe. Four independent hosted VMs now run the
complete suite alongside media QA, each retaining `workers:1`, serial files,
unchanged120s per-test timeout, fixtures, assertions and no assertion retries.
Matrix fail-fast is disabled, preserving every shard's evidence on failure.

Actual discovery is291 cases split78/81/61/71. The full inventory and each
shard must be nonempty, unique, disjoint and exactly equal in union. Actual JSON
execution reports must additionally identify the exact source candidate and
shard, prove every case ran once successfully, and have no global error,
skip, flake, retry or missing result. The required `typescript-and-media` gate
checks all four job families and validates these receipts against fresh discovery.
Missing/failed/cancelled/skipped jobs fail closed.

Every PR synchronization and main push runs Verify. Feature push is no longer a
second duplicate of the PR run. No path filters or conditional assertion bypass.
Native remains unchanged; every root Vitest, FFmpeg, build, OTIO/interchange,
CLI, format, type, lint and locale gate remains. Browser traces/reports use only
synthetic fixtures and expire after7days. No dependency/runtime/schema change.

## Actual local proof

- Real website build reproduced both dead links before correction:
  `/tmp/openfilm-ci-e2e-docs-red.log`; after correction passes in12.48s,
  `/tmp/openfilm-ci-e2e-docs-green.log`.
- Coverage/gate unit tests:33passed before the trigger regression addition.
  A separate trigger RED has14passed/1failed until duplicate-run scheduling changes.
- Actual Playwright list-only discovery passes all291 cases, shards78/81/61/71;
  TypeScript/Vue passes. Listing is inventory proof, not browser execution proof.
- Running website installation then locale validation reproduced a second issue:
  the mirror scanner/sidebar included installed dependency Markdown. Both now
  exclude `node_modules`; a synthetic fixture proves dependency docs are ignored
  while a genuinely missing owned mirror still fails. No owned docs are exempted.
- Corrected source873ef8e passes328files/4591 full local unit/integration tests
  in396.98s. Its product-source parent1798663 passes all291 local browsers in22.7m.
  Actual hosted291-case execution for873ef8e is verified below.

## Independent review correction

One fresh whole-branch review of5cea653 found one Important workflow issue:
job-level `env` cannot access `runner.temp`, and GitHub rejected Verify41049947487
before scheduling jobs. Move the JSON output path to the Playwright step's `env`.
A regression first fails on the invalid scope, then passes on the corrected
placement. No other Important/Critical issue was found. Corrected hosted jobs
must actually schedule, execute every case and validate all four receipts before
merge; the initial failed workflow remains recorded.

Pinned actionlint1.7.7 independently reproduces the invalid runner context and
passes the corrected workflow; all34 focused regressions pass.

## Actual hosted results and observed timing

Source:`873ef8e81ad9eae4c3853a90eb70afeb32828cda`.
PR checkout:`f73c8207a58e0942488b91e1b4467fffc5f69522`, base1798663.
Verify41050259206, Windows41050259314 and security41050259268 all pass.
Actual results:1124contracts +3467media =4591tests, all291 Chromium,
23Rust/2archive,18officialOTIO plus CLI/build/types/format/locales/lint.
Windows supplies121focused and13original browser passes. No workstation claim.

| Hosted measurement                    | Serial parent1798663 /41047483094 | Four VMs873ef8e /41050259206 |
| ------------------------------------- | --------------------------------- | ---------------------------- |
| Chromium elapsed step / longest shard | 23m24s                            | 11m18s                       |
| Complete Verify start→completion      | 34m39s                            | 12m55s                       |
| Heavy media job                       | 33m52s including browsers         | 9m31s with browsers parallel |
| Browser jobs including setup          | one serial owner                  | 7m05s /12m19s /7m35s /9m13s  |
| Website                               | not checked in PR                 | 31s, passed                  |

This pair observes51.7% lower browser elapsed time and62.7% lower complete Verify
elapsed time on four isolated VMs. Host load/setup varies; these are observed
runs with the same product code, not a workstation performance guarantee.
The former PR70 baseline remains45m35s/46m26s with30.0m Chromium.

All four actual JSON reports were downloaded and validated locally, and the
hosted required aggregate independently returns291, shards78/81/61/71,
verified:true and candidate873ef8e. No missing, duplicate, skipped, flaky,
retried or failed case. Reports prove execution, not just list-only selection.

The integration order merges PR71 into PR69 before main, so main receives the
Windows repairs and known Pages fix together. Final metadata-only reconciliation
is revalidated on PR69. Main deployment/Verify run URLs are recorded there after
merge; historical failed/cancelled runs remain historical.

## Boundaries

Old failed runs remain historical evidence. A current successful main Verify and
actual Pages deployment are required for closure. Linux synthetic CI and narrow
Windows2022/FFmpeg9 tests do not certify physical Windows10/popopc, macOS,
native installer, Resolve, hardware audio/display or4K workstation QA.
