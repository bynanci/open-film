# Website gate and isolated E2E evidence

Date:2026-10-30. Branch:`codex/ci-pages-e2e`.
Initial base:`1798663372fc0b2073c1561b589e176061160bb7` (Windows PR69),
stacked on main8de63ae. Stable release remainsv0.4.0.
Status: implementation and local focused checks pass; exact-head hosted checks,
independent final review, merge and actual main deployment remain pending.

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
- Full local unit/browser and all hosted shard timings are recorded separately
  when complete; no measured speedup or completion is claimed yet.

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

## Boundaries

Old failed runs remain historical evidence. A current successful main Verify and
actual Pages deployment are required for closure. Linux synthetic CI and narrow
Windows2022/FFmpeg9 tests do not certify physical Windows10/popopc, macOS,
native installer, Resolve, hardware audio/display or4K workstation QA.
