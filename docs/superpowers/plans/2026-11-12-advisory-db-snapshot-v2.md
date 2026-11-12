# Advisory DB Snapshot v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the exact original shallow boundary in new RustSec captures and verify faithful offline reconstruction through the complete existing native admission path.

**Architecture:** One cohesive protocol task changes the producer, Python CLI/replay, TS bridge, standalone collector and synthetic fixture together. Shared DB capture/materialization/verification remains in `scripts/security/audit-native.py`, reached through the existing `policy.auditor` authority; no second admission engine or seventh policy import. New policy requires audit v2; old v1 artifacts remain with their exact old tools.

**Tech Stack:** Existing Python 3.11+ standard library, local Git, TypeScript/Node, Vitest, current native-admission tooling; no new dependencies.

**Spec:** [2026-11-12-advisory-db-snapshot-v2-design.md](../specs/2026-11-12-advisory-db-snapshot-v2-design.md).

## Global constraints

- Implement within the existing user-authorized issue #140 scope. This plan grants no new external authority; release, signing, admin and OS gates remain separate.
- Starting reviewed base: `81714e287a76aac1e46b6bea7e1806a408aa9a63`; isolate future implementation without changing the two current clean checkouts.
- New audit integer `schemaVersion:2`; exact `dbSnapshot.format:"git-shallow-bundle-v1"`; fixed ordinary `advisory-db.bundle` and `advisory-db.shallow` leaves; exact nested fields/types from the spec.
- Retain **original** single-HEAD SHA-1 plus LF bytes, exactly 41 bytes. Restore only those captured bytes into a new private bare clone; no normalization/synthesis/fetch/old-artifact mutation.
- Keep envelope/admission/observation schema v1, original JSON/float bytes, all existing 16 roles plus the sidecar: 17 payload pins and 18 pins in the minimal TS observation.
- Keep all six current `POLICY_FILES`, exact tool/subject byte/blob identity, complete admission equality, original absolute source path and full candidate history.
- Keep six-hour freshness, cargo 1.99.0, cargo-audit 0.22.2, pnpm 11.11.0 package pin, current byte/time limits and read-only workflow permissions.
- New policy rejects v1/unknown/incomplete captures. Historical v1 behavior remains tied to old authorities and original artifacts; the old base's capture cannot admit changed policy.
- Producer/consumers/fixture ship together. Paired docs and review/hosted evidence are separately owned coordinator steps below, never a half-integrated schema release.

## Review focus

- Caller Git overrides/config or external object stores must not change the boundary or satisfy missing current objects; test direct shared verification and the real TS/Python entry path.
- A legitimate missing shallow parent must pass while a missing current subtree/blob must fail; use loose-object fixtures so bundle clone failures cannot mask absent fsck validation.
- A caller can re-pin malformed sidecar bytes or strip a v2 artifact into a claimed v1 shape; strict v2 metadata and complete original-admission binding must still reject them.
- Existing/symlink destinations, linked Git directories and source DB drift must block without changing caller/source sentinels.
- Expiry can occur during validation; preserve evaluation against the original fetch time at complete admission, not a cached preflight time.

---

### Task 1: Implement the complete audit-v2 producer and consumer protocol

This is the only implementation/review task. Its deliverable is one independently testable, fully integrated protocol change; do not split its layers into separately published commits/PRs. A single worker owns its shared fixture/state to prevent concurrent drift.

**Files to modify:**

- `scripts/security/audit-native.py:71` — existing `verify_advisory_bundle`, `retain_advisory_bundle`, `capture_audits`, plus shared functions specified below.
- `scripts/security/native-admission.py:94` — `evaluate_native`; `:123` — `verify_admission` and DB check at `:149`.
- `scripts/native/receipt-security.py:32` — `replay`, preserving preflight before existing clone at `:51`.
- `scripts/native/receipt-security.ts:16` — `verifySecurityClosure` and raw roles/metadata pins.
- `scripts/native/replay-security-artifact.py:306` — `FIXED_FILES`; `:311` — `build_payload`; preserve `POLICY_FILES:300`, `verify_policy:376` and `replay_snapshot:388`.
- `tests/fixtures/native-security-replay.py:60` — synthetic shallow DB retention and actual complete CLI.
- Test: `scripts/security/test-audit-native.py:60`, `scripts/security/test-native-admission.py:13`, `scripts/native/test-replay-security-artifact.py:153`, `tests/integration/native-security-receipt.test.ts:19`.

**Interfaces:**

- Consume existing `controls.capture(command,cwd,prefix,timeout=1200,env=None)` at `run-glib-controls.py:27`, existing source pin/hash helpers and `policy.auditor` import. Do not change the supervisor's public API or the six-authority import set.
- Produce `advisory_git_environment() -> dict[str,str]`, `advisory_git_command(*args:str,allow_https:bool=False) -> list[str]`, and `advisory_git(directory:Path,*args:str,timeout:int=30) -> bytes` with the spec's isolation and transport controls.
- Produce `read_advisory_state(database:Path,expected_commit:str,*,require_worktree:bool=False) -> tuple[str,bytes]` returning root tree and exact original boundary.
- Produce `validate_advisory_snapshot_metadata(audit:dict) -> dict`, `read_advisory_snapshot(audit_directory:Path,audit:dict) -> tuple[Path,bytes]`, and `verify_advisory_database(database:Path,audit_directory:Path,audit:dict) -> None` with strict v2 binding and ordinary full fsck.
- Produce `restore_advisory_snapshot(audit_directory:Path,database:Path,audit:dict) -> None` for private materialization only; its producer/receipt callers immediately invoke shared verification or complete admission.
- Extend existing `retain_advisory_bundle(database,bundle,expected_commit,*,captured:tuple[str,bytes]|None=None) -> dict` to return exact `dbSnapshot` metadata. The real capture always supplies original pre-scan state; a three-argument call reads current strict v2 state.
- Extend existing `verify_advisory_bundle(bundle,expected_commit,*,snapshot:dict) -> None` to restore and verify privately. Preserve `capture_audits`, `verify_admission`, `verifySecurityClosure`, `build_payload` and replay external return shapes.

- [ ] **Step 1: Add the first behavior RED regression using the existing retainer call.** In `AdvisoryBundleTests`, save exact original `db/.git/shallow`, call `retain_advisory_bundle(db,bundle,head)` with its current three positional arguments, then require `advisory-db.shallow` to exist and equal the saved bytes. Retain the two-commit origin, real depth-one clone, visible-only ZIP and deleted origins. Do not start with an undefined helper assertion.

- [ ] **Step 2: Run that regression and retain its expected RED result.** Run `python3 scripts/security/test-audit-native.py AdvisoryBundleTests.test_shallow_bundle_survives_visible_only_archive_and_detects_tampering`. Expected before implementation: failure because the ordinary sidecar does not exist; current code retains only the bundle. Keep command/stdout/stderr/exit as development evidence, not a security capture.

- [ ] **Step 3: Add strict schema, isolation and direct connectivity test cases.** Define `test_v2_metadata_rejects_unknown_types_fields_formats_and_versions`, `test_captured_boundary_and_worktree_drift_block_retention`, `test_restored_boundary_requires_original_bytes_and_private_destination`, `test_git_overrides_and_alternates_cannot_mask_missing_objects`, and `test_shallow_parent_is_allowed_but_missing_current_tree_or_blob_fails`. Assert all cases in the spec. The last test builds a loose-object bare DB with nested tree/blob and parent/child commits, removes only the parent for a passing shallow baseline, then separately deletes a referenced subtree/blob while keeping HEAD/root tree/boundary unchanged. Require the production verifier to fail, not merely clone/unpack.

- [ ] **Step 4: Add cohesive consumer and fixture regressions.** Add `test_new_policy_rejects_clean_v1_and_stripped_v2_before_restore`, `test_v2_payload_contains_all_17_original_roles`, missing/duplicate/tampered sidecar cases and six-policy mismatch preservation in the Python suites. In TS add tests named `requires all 17 v2 payload roles and 18 minimal observation pins`, `rejects re-pinned invalid original shallow bytes`, and `replays a visible-only v2 producer artifact without upstream repositories`; preserve existing whole-result, original-path-before-malformed-bundle, float-byte, source/lock/graph/raw-report and stale/future faults. Update eligible pure admission fixtures to explicit schema2 metadata; retain the existing real synthetic fixture until producer/CLI support is ready. Assert a stale/future v2 snapshot remains blocked and mock the existing module clock for expiry after verification begins.

- [ ] **Step 5: Implement shared Git isolation and strict metadata/state readers in the existing auditor.** Use the exact signatures above. Remove caller `GIT_*` and GitHub-token variables from child environments, set deliberate minimal Git variables, disable global/system config/templates/hooks/replacements/lazy fetch, allow local transport only except the one original explicit HTTPS fetch, and reject external Git directories/object stores/grafts/promisor/include configuration. Require exact nested v2 metadata, fixed ordinary file paths and bytes/digests; use `type(...) is int` for schema/sizes. Reuse `source.no_link_parents`; do not create another policy module.

- [ ] **Step 6: Implement v2 retention, private restoration and real connectivity verification.** Extend existing retainer/verifier with the specified signatures. Retain captured original bytes exclusively; clone the local bundle only into a new private bare destination; write its own ordinary `shallow` file from retained bytes. Validate actual HEAD/tree/shallow against captured values, clean non-bare DBs, and require `git --no-replace-objects fsck --full --no-reflogs` exit zero. `restore_advisory_snapshot` materializes; `verify_advisory_bundle` immediately calls full shared verification. No result flags, error allowlists, inferred boundaries or fetches.

- [ ] **Step 7: Wire real capture and complete Python admission together.** Initialize schema2; capture original clean DB tree/boundary immediately after the reviewed depth-one fetch, preserve it across the three existing scans and pass it to retention; recheck clean unchanged state before verified capture. Pass isolated Git env through existing nested `capture`/`must` wrappers for DB operations. In `verify_admission` reject duplicate audit keys and call the shared DB verifier in place of HEAD-only checking; in `evaluate_native` require strict v2 metadata while preserving output schema, all four digests, three reports and original six-hour rule. In Python `replay`, retain original-path preflight, restore privately through `policy.auditor`, then invoke unchanged complete admission shape.

- [ ] **Step 8: Wire both collectors and the synthetic fixture in the same task.** TS requires schema2, adds the sidecar fixed role, compares original bundle/sidecar pins to captured metadata and transfers exact bytes. Standalone `FIXED_FILES` adds only the sidecar, still adds exactly six distinct report leaves, checks v2 and keeps envelope/API unchanged. Update Python fixture to use actual v2 producer helper and complete CLI; update TS fixture pin inventory to admission plus 17 payload files. Keep all six policy identities/equality and full candidate historical-source checks unchanged. Do not add dual-version fallback or execute artifact code.

- [ ] **Step 9: Run focused GREEN checks against the cohesive implementation.** Execute from its isolated worktree with frozen dependencies and the reviewed package-manager pin. Expected: all tests exit zero, including restored shallow/fsck success, all negative fixtures and every pre-existing fault. No skips/retries or assertion weakening.

```bash
python3 scripts/security/test-audit-native.py
python3 scripts/security/test-native-admission.py
python3 scripts/native/test-replay-security-artifact.py
pnpm exec vitest run tests/integration/native-security-receipt.test.ts tests/unit/native-candidate-receipt.test.ts
pnpm typecheck
pnpm exec eslint scripts/native/receipt-security.ts tests/integration/native-security-receipt.test.ts --max-warnings=0
pnpm exec prettier --check scripts/native/receipt-security.ts tests/integration/native-security-receipt.test.ts
```

These command names/entry points come from current scripts and `package.json`; Python tests use `unittest`, not pytest. Do not claim full native validation from them. Python/Git are available; Node dependencies exist in the preserved temporary checkout; cargo/rustc/rustup are unavailable on the inspected PATH. Do not install or change pins as an undocumented shortcut.

- [ ] **Step 10: Review the entire protocol diff, then make one cohesive local commit when execution is authorized.** Stage only the ten listed implementation/test/fixture paths after confirming no unrelated changes; commit message `fix: preserve original advisory database shallow snapshots`. Record actual new six-file identities. This plan does not authorize pushing, opening a PR, merging or dispatching anything.

## Separate coordinator follow-through: paired documentation

After Task 1 passes its focused tests, the coordinator owns these changes in the same reviewable branch before it is considered complete:

- [ ] Update `docs/validation-native-candidate-receipt.md:91` and `docs/en/validation-native-candidate-receipt.md:91` together: exact v2 bundle+sidecar, strict new-policy gate, 17/18 counts, private restoration/full fsck, original-path/six-hour/complete-result requirements, and historical v1 authority distinction. Preserve historical observation records rather than rewriting their format or result.
- [ ] Update `.github/workflows/native-security.yml:64` step wording and `:74` upload comments to name both ordinary files. Whole-directory upload already includes the sidecar; do not change permissions, triggers, scanner/toolchain pins or hidden-file policy.
- [ ] Run the exact existing checks below. Expected exit zero. No runtime/target observation or installer completion claim follows from documentation checks.

```bash
pnpm exec prettier --check docs/validation-native-candidate-receipt.md docs/en/validation-native-candidate-receipt.md .github/workflows/native-security.yml
pnpm test:docs-i18n
pnpm test:license
pnpm test:provenance
```

## Separate coordinator follow-through: integration and hosted evidence

- [ ] Run the existing relevant broad checks once after the final changes, then obtain independent whole-branch review. Exact available project commands are `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test:media`, `pnpm test:ci-partition`, plus the already focused Python suite. The media lane includes the TS bridge; the pure-logic `pnpm test:contracts` lane does not. Required CI may run all configured lanes and native checks; record exact final head/attempt. `pnpm test:native` expands to cargo fmt/clippy/test and cannot run in the currently inspected shell without the real toolchain.
- [ ] Verify old artifacts and v1 observation documents remain byte-identical. Verify new tools reject an old-policy subject through all six exact policy identities; do not bypass that gate to demonstrate compatibility. Record any legacy checks as historical, still-expired evidence.
- [ ] When separately authorized to publish/run, review a candidate **C** containing the cohesive protocol plus paired docs and record its commit/tree and new six-file identities. A capture from base `81714` or A151 cannot admit this changed policy. Use the existing reviewed Linux source-admission workflow at C, real cargo 1.99.0/cargo-audit 0.22.2, real source/closure/optimized controls and original current RustSec fetch. Capture every failed/successful attempt without retry-until-green behavior.
- [ ] Authenticate the actual successful capture run/workflow/head/artifact identities; retain original ZIP bytes/SHA-256 and audit fetched time. Inspect schema2, exact sidecar/tree/bundle bindings, all 17 payload roles, complete original admission and source cleanliness. Record the six-hour deadline from that unmodified original timestamp.
- [ ] Before that deadline, use the existing standalone replay workflow on a fresh isolated runner with subject C at `/home/runner/work/open-film/open-film`; tool revision T must contain byte-identical six policies. Preserve authenticated raw transport, all original bytes and full candidate historical source objects. Require source replay status verified, original full admission equality, stderr empty and `distributionApproved:false`. Retain actual replay run/artifact IDs and raw results; synthetic/local success is insufficient. A later docs-only T is acceptable only if all six policy bytes/blobs still match C.
- [ ] Publish only reviewed observed facts when that external work is authorized. Do not change old artifacts, fetch missing historical ancestry, renew timestamps, label historical success as fresh v2, approve native distribution, merge, create a release/tag, write admin settings or touch credentials under this plan.

## Plan self-review and remaining decision

The single task covers the full wire protocol, shared verification and fixture cycle. Every review-focus case has a regression step. Schema fields/signatures, 17/18 counts, capture timing, isolated Git commands and legacy/new-authority boundary match the companion spec. Paired docs and external integration are coordinator follow-through, not independently publishable schema changes.

No significant format or compatibility decision remains unresolved in this draft: **new policy is v2-only; v1 stays with historical authority**. Coordinator accepted this narrow new-format decision within the existing remediation scope; it does not decide any release exception. Exact future candidate/run/artifact identifiers remain intentionally unavailable until separately authorized work produces them; no current-base capture is substituted.
