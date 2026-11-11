# Native Source Replay Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans task-by-task within the existing worker assignment; root and whole_delivery_review supply independent review. Do not spawn further agents.

**Goal:** Authenticate retained source evidence and run the unchanged full original-path Python replay on a fresh hosted Linux runner.

**Architecture:** A new standalone dispatch workflow with a narrow Python transport/helper. Trusted dispatcher tools and historic candidate checkouts are separate; raw artifact bytes remain unchanged and the entire replay result must equal original admission.

**Tech Stack:** Python3.11+ standard library, Git, patch, authenticated GitHub Actions read API; existing native receipt/security authority unchanged.

**Spec:** `docs/superpowers/specs/2026-11-11-native-source-replay-design.md`.

## Global constraints

No source authority changes, automatic gate changes, runtime/trust claims, arbitrary commands/URLs, clock overrides, dispatch/retry/write permissions. Fresh allowlisted original production path; artifact compressed200MiB/expanded300MiB/10000entries; raw8MiB/file32MiB/total48MiB/payload. Root approved implementation after Astra design review with the three mandatory guards now in the spec. Six-hour original audit freshness remains mandatory. Work only in owned branch at main9f4; signed commits NAN CHUN WANG <by.nanci.tw@gmail.com>.

## Review focus

- Authenticated run/head repository differs from repository: reject before download/extract (Task1).
- ZIP directory/file aliases or parent collision: reject without outside writes (Task1).
- Preexisting runner workspace/config or candidate mismatch: fail without clobber (Task2).
- Passing subprocess output differs in any original admission field: reject (Task2).
- Source artifact is still downloadable but six-hour audit freshness expired: existing replay fails (Task2).

## Task 1: Authenticate and retain bounded original bytes

Files: create `scripts/native/replay-security-artifact.py` and `scripts/native/test-replay-security-artifact.py`.
Interfaces: `verify_transport(run, artifact, workflow, expected)` validates API objects; `extract_snapshot(archive, destination, expected)` returns extracted root; `build_payload(evidence)` returns original-byte schema1 payload, retained admission and raw pins. Network CLI performs same-repository API reads and bounded archive download; no caller URLs.

- [x] Add failing tests for successful real ZIP/raw-byte roundtrip and every identity/hash/expiry/path/type/alias/size fault in the spec; mock actual HTTP request/redirect boundary and prove cross-origin storage never receives Authorization/cookies; prove no existing output overwritten.
- [x] Run `python3 scripts/native/test-replay-security-artifact.py` and retain RED output.
- [x] Implement only the authentication, bounded downloader/extractor and strict byte-preserving payload collection needed by those tests.
- [x] Run same tests GREEN; record original and extracted SHA256 equality, source metadata bytes untouched.

## Task 2: Fresh checkout and full real replay

Files: extend helper/test above; reuse existing `scripts/native/receipt-security.py` and source/admission validators without modification.
Interfaces: `replay_snapshot(tools, repository, payload, admission)` runs the fixed existing Python CLI and requires whole parsed output equality. CLI production root remains fixed allowlist; internal test fixtures may provide explicit fresh temporary roots to test the same no-link/no-clobber boundary. `prepare_candidate(root, sha, origin)` accepts only fixed authenticated origin from CLI, creates fresh checkout, verifies exact clean HEAD; no reset/delete. Sanitize Git config/environment and disable hooks/filters/LFS; full clone with historical BASE and LOCK_BLOB object/path identity checked. Compare/retain all six tool/candidate policy Git blobs and working bytes before policy execution.

- [x] Add actual CLI integration fixture based on existing source/admission fixture generation: original metadata at recorded temporary path, remove only test-owned producer fixture, create separate checkout there, then full replay; no monkeypatched pass/evaluator result.
- [x] RED tests for occupied/nonordinary parents/wrong candidate/environment, changed policy blob/working byte in each of six files, malicious configured smudge/hooks and missing historical objects, tampered metadata/lock/scans/bundle, changed entire admission result and stale/future fetch time.
- [x] Implement fresh checkout checks and fixed subprocess invocation, original bytes unchanged, bounded output/timeout and explicit result equality.
- [x] GREEN integration; prove byte pins unchanged, general source/closure rejection behavior preserved. Run existing Python source/closure/audit/admission tests and TS native-security-receipt integration.

## Task 3: Narrow independent workflow and review package

Files: create `.github/workflows/native-security-replay.yml`; add workflow assertions in focused helper tests; update only these spec/plan docs as decisions require. Original automatic/admission workflows remain unchanged; add the new Python test command and fetch-depth:0 ONLY to ci.yml native-shell checkout (with corresponding workflow contract assertions), preserving ref/source guard/all gates. Root separately approved full history as necessary for the actual historical-object regression; no hidden test fetch or synthetic-only downgrade.

- [x] RED assertions: five strict dispatch inputs, Ubuntu runner, contents/actions read only, explicit tool/candidate SHA separation, no existing workflow mutation or runtime/build prerequisite.
- [x] Add fixed-origin trusted tool bootstrap, helper invocation with inputs passed as environment/data (no shell interpolation), bounded result artifact retention and timeout. No automatic trigger or workflow_call.
- [x] GREEN focused tests; run native focused regressions, typecheck/lint/format/docs/license/partition checks as applicable; verify frozen dependency links belong to this worktree first.
- [ ] Record commands/RED/GREEN/source hashes/limits and actual-versus-blocked claims in execution report; signed commit, DCO validation, root/whole_delivery_review independent review. No push/PR/merge/dispatch by worker.
- [ ] Root owns the subsequent independent draft PR, full CI and merge registration and one hosted actual-artifact replay if still fresh. If expired, report stale honestly; do not rerun into green or silently substitute evidence.
