# Advisory DB snapshot v2 implementation specification

Engineering specification, 2026-11-12, within the existing issue #140 remediation scope. This document specifies one cohesive producer/consumer protocol change and grants no distribution, signing, release or administration authority. Its companion is [the implementation plan](../plans/2026-11-12-advisory-db-snapshot-v2.md); historical evidence is retained in [the source replay record](../../validation/issue-followup-2026-11-12.md).

## Outcome and boundary

New native source captures retain the **exact original** RustSec depth-one `.git/shallow` bytes as the ordinary artifact `audit/advisory-db.shallow`, bind them and the bundle in audit schema v2, and verify the faithfully restored shallow repository with ordinary `git fsck --full --no-reflogs`. Producer, original CLI admission, Python receipt replay, standalone replay collection, TS bridge and synthetic fixture change together. No intermediate producer-only schema may be published.

The current reviewed base is `81714e287a76aac1e46b6bea7e1806a408aa9a63`. The historical A151 bundle has a complete HEAD tree but no serialized shallow boundary; its missing parent and failed full fsck remain recorded. The successful v1 source replay and expired `2026-11-12T06:03:43.513366Z` freshness deadline are historical. Do not modify their bytes, supply a synthesized boundary, fetch ancestry, change timestamps, rerun scans under their identity or relabel them as v2.

New policy requires audit v2. Historical v1 remains supported by its exact historical tools and artifacts; new tools must fail the existing six-file policy equality check against that old subject. There is no caller-selected legacy mode and no missing-sidecar fallback. A new candidate containing the changed authority needs its own fresh capture and original-path replay. The existing base's captures cannot admit the changed authority.

## Exact protocol

Change new `audit/audit.json` from integer `schemaVersion: 1` to integer `schemaVersion: 2`. Preserve every other current field and meaning. Add exactly this required field:

```json
{
  "dbSnapshot": {
    "format": "git-shallow-bundle-v1",
    "tree": "<40 lowercase hexadecimal SHA-1 tree ID>",
    "bundle": {
      "path": "advisory-db.bundle",
      "size": 12345,
      "sha256": "<64 lowercase hexadecimal SHA-256>"
    },
    "shallow": {
      "path": "advisory-db.shallow",
      "size": 41,
      "sha256": "<64 lowercase hexadecimal SHA-256>"
    }
  }
}
```

- `dbCommit` remains the recorded HEAD and must be exactly 40 lowercase hexadecimal characters. `tree` must equal that commit's actual root tree.
- `schemaVersion` must have Python `type(value) is int` and equal 2. Reject booleans, floats, strings, v1 and unknown versions in the new policy.
- `dbSnapshot`, `bundle` and `shallow` require exactly the keys above. Reject unknown keys, unknown formats and malformed field types. Preserve the existing broader audit fields rather than inventing an unrelated audit-wide exact-key migration.
- Both `path` values are fixed ordinary-file leaf constants relative to `audit/`, never caller-selected paths. Read with nonsymlink parent checks and ordinary-file type checks; reject symlinks, nonregular files and existing output destinations.
- Bundle `size` must be an integer in `1..8 * 1024**2`; shallow `size` must be integer 41. Require actual sizes and SHA-256 digests to match the metadata before cloning/restoring.
- The original shallow bytes must be exactly one lowercase 40-hex commit ID followed by LF, naming `dbCommit`. Compare the bytes read from the original file; do not construct the retained/restored bytes from the commit ID. Reject CRLF, no final LF, extra boundaries, full-history DBs or another object format. Future support requires another reviewed format.
- Keep replay envelope `{schemaVersion:1, files}` and its exact original base64 bytes. Keep admission output schema v1, four evidence digests, observation schema v1, original float representation and complete-result equality. `evidenceDigests.audit` already binds canonical v2 audit metadata. No `snapshotVerified` flag replaces filesystem checks or changes an original object during replay.
- Keep current per-file 8 MiB, payload/total limits and timeouts. No new dependency, Git version pin, scanner/compiler version or workflow permission is introduced.

## Required roles and unchanged authority

The existing ten fixed payload roles are:

```text
source.json
closure.json
controls/regression.json
metadata.json
audit/audit.json
audit/actual-metadata.stdout
audit/current-registry-metadata.stdout
audit/current-registry-Cargo.lock
audit/historical-Cargo.lock
audit/advisory-db.bundle
```

Keep all ten plus all six report-named stdout/stderr roles. V2 adds `audit/advisory-db.shallow`: **17 payload pins**. TS `security.raw` also pins `admission.json`: **18 TS observation pins** for the minimal fixture. Existing observation limits may permit unrelated extra raw evidence, so assert 18 for that exact fixture, not a global prohibition on all additional observations. Continue requiring exactly one pin for every required role and rejecting duplicate role aliases.

Do not change `POLICY_FILES` or weaken `verify_policy`. The six existing authorities and their current-base identities are:

| Authority path                            | Git blob at base                           | SHA-256 at base                                                    |
| ----------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| `scripts/native/receipt-security.py`      | `a7ac9d84947a949a427720135c36934ed25cc056` | `d6925ccda6e6a8c6f34816a950798ba9957589f657914a250baf8f28fdf40f5b` |
| `scripts/security/native-admission.py`    | `f58e28c193c7154e7049d2b5414bcb1b90994e08` | `c44e229ea4a960f15e4f4d9a0fc495b83775345f4a64a7c5b477f0798027c560` |
| `scripts/security/verify-glib-closure.py` | `2dbdb3f906b5484cb4ffedd868c0f4c02208689a` | `a2acc796b5122279b1724f92d76080cfc22652967244ffd9aa1f8bc2a9308e1e` |
| `scripts/security/verify-glib-source.py`  | `38d06c697653b10d5330f30bf4624e4bcdf5debd` | `ead85d2486f68144f5104118a1c38dc8a7c792232c7168506b6bf3108c0594c1` |
| `scripts/security/run-glib-controls.py`   | `57b30578297458c038d21637bc362aade12e249b` | `6df8d34390165294908cd4a14ba9d5e883129816889d05c8662a561769a05da6` |
| `scripts/security/audit-native.py`        | `d1bdb71914418f20c76d4d07b48901d019859883` | `7adb2512d8b650a6e9eced93781ad86e61ee1b15029286bbe6c0515ccd45538a` |

These identify the reviewed starting state, not hashes to keep hard-coded after editing. The new candidate records its actual new identities. Tool/subject equality must still compare every current committed blob, working byte and committed `git show` byte. Do not add a seventh imported policy module: put the shared implementation in the existing auditor exposed through `policy.auditor`.

## Current anchors and new interfaces

Line anchors refer to the reviewed base and will move during implementation.

| Current entry point                                         | Current anchor                                           | Required change                                                                                                                                                               |
| ----------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verify_advisory_bundle(bundle, expected_commit)`           | `scripts/security/audit-native.py:71`                    | Retain the name; add required keyword-only `snapshot` metadata and verify a newly restored private clone.                                                                     |
| `retain_advisory_bundle(database, bundle, expected_commit)` | `scripts/security/audit-native.py:80`                    | Retain three positional arguments; add optional keyword-only `captured` state; return v2 `dbSnapshot` metadata. Every new call emits v2, never legacy format.                 |
| `capture_audits(repository, output)`                        | `scripts/security/audit-native.py:90`                    | Start v2, read initial original state after fetch at line 111, pass it through retention at line 148. Preserve all raw capture/error behavior.                                |
| `controls.capture(..., env=None)`                           | `scripts/security/run-glib-controls.py:27`               | Reuse its existing `env` support through the auditor's nested wrappers; do not change this supervisor's public API.                                                           |
| `evaluate_native(...)`                                      | `scripts/security/native-admission.py:94`                | Require strict v2 metadata; preserve result and all existing report/freshness rules.                                                                                          |
| `verify_admission(repository, directory, result=None)`      | `scripts/security/native-admission.py:123`               | Parse audit with duplicate-key rejection; replace HEAD-only DB check at line 149 with shared complete DB verification.                                                        |
| `replay(repository, value)`                                 | `scripts/native/receipt-security.py:32`                  | Keep materialization limits and original-path preflight at line 48, replace embedded clone at line 51 with shared private restoration, then complete admission.               |
| `verifySecurityClosure(...)`                                | `scripts/native/receipt-security.ts:16`                  | Require v2 and all 17 original roles; transfer original sidecar bytes and compare bundle/sidecar pins against captured size/digest metadata.                                  |
| `FIXED_FILES`, `build_payload(evidence)`                    | `scripts/native/replay-security-artifact.py:306`, `:311` | Add the sidecar as the eleventh fixed role, retain six report roles; require v2 before admission. Preserve API return `(payload, admission, pins)` and transport protections. |
| `verify_policy(...)`, `replay_snapshot(...)`                | `scripts/native/replay-security-artifact.py:376`, `:388` | Preserve exact six-file authority and whole-admission equality; existing generic sanitized policy rejection can cover snapshot failures.                                      |
| synthetic Python fixture                                    | `tests/fixtures/native-security-replay.py:60`            | Use the actual v2 retainer and full CLI; emit only explicit synthetic v2 evidence under new tools.                                                                            |
| TS fixture                                                  | `tests/integration/native-security-receipt.test.ts:19`   | Add the ordinary sidecar pin; assert exact minimal role counts and real bridge behavior.                                                                                      |

Define these shared interfaces in `scripts/security/audit-native.py`:

```text
advisory_git_environment() -> dict[str, str]
advisory_git_command(*args: str, allow_https: bool = False) -> list[str]
advisory_git(directory: Path, *args: str, timeout: int = 30) -> bytes
read_advisory_state(database: Path, expected_commit: str,
                    *, require_worktree: bool = False) -> tuple[str, bytes]
validate_advisory_snapshot_metadata(audit: dict) -> dict
read_advisory_snapshot(audit_directory: Path, audit: dict) -> tuple[Path, bytes]
verify_advisory_database(database: Path, audit_directory: Path, audit: dict) -> None
restore_advisory_snapshot(audit_directory: Path, database: Path, audit: dict) -> None
retain_advisory_bundle(database: Path, bundle: Path, expected_commit: str,
                       *, captured: tuple[str, bytes] | None = None) -> dict
verify_advisory_bundle(bundle: Path, expected_commit: str,
                       *, snapshot: dict) -> None
```

`read_advisory_state` returns `(root_tree_id, original_shallow_bytes)` after HEAD/boundary/owned-repository checks. `require_worktree=True` also requires an ordinary owned working clone and clean index/worktree including untracked files. `validate_advisory_snapshot_metadata` returns the validated `dbSnapshot` object without adding flags. `read_advisory_snapshot` returns the validated ordinary bundle path and original sidecar bytes. The verifier calls that reader, compares actual repository state to metadata and original bytes, requires any non-bare database worktree clean, then runs full fsck.

`restore_advisory_snapshot` validates inputs, refuses any existing destination/symlink, clones only the local bundle into a new private bare destination, and writes the exact sidecar bytes exclusively into that clone's own `shallow` file. It materializes only; its callers must immediately validate before accepting the DB. The producer's `verify_advisory_bundle` calls restore then `verify_advisory_database`; the receipt replay calls restore then complete `verify_admission`, whose shared verifier is mandatory. This avoids duplicate fsck runs or a mutable “already verified” flag.

When `captured` is supplied, retention must compare current tree/boundary to those exact initial values before creating outputs. The real producer always supplies it. The three-argument test/helper call captures the current strict v2 state itself and returns the same v2 metadata; this preserves the current callable shape for a meaningful first RED regression without introducing v1 format fallback.

## Capture sequence and original-byte guarantees

1. Capture the existing explicit RustSec HTTPS depth-one fetch through the supervisor with the isolated Git command/environment. Record unchanged HEAD/fetch time semantics. Read original tree/shallow state immediately and require a clean DB.
2. Run all three existing `cargo +1.99.0 audit --db ... --no-fetch --file ... --json --deny unsound` scans and graph/source/lock controls unchanged. Keep actual, current registry and historical report identities, stdout/stderr bytes and compiler/scanner pins.
3. Require the same HEAD/tree, **the same original shallow bytes**, and a clean index/worktree after scans. Keep existing source/lock unchanged checks. Fail on drift; do not retry until a convenient state appears.
4. Retain the ordinary bundle and sidecar exclusively, compute their actual metadata, restore into a new private bare DB, verify its recorded state and connectivity, and only then set `verified: true`. Partial files may remain with the existing failed capture record; they never qualify as verified evidence.
5. Original CLI admission checks that the original database boundary equals the sidecar and runs the same full verifier **without writing into that original DB**. Replay writes only into its newly created private clone. Never synthesize or repair a boundary for v1 or mutate a source/candidate repository.

## Hostile Git isolation and connectivity

All new DB Git operations must use the shared helper, including direct TS-to-Python replay; the standalone dispatcher's existing environment sanitizer alone does not protect the direct bridge. Start from a copy without caller `GIT_*`, `GH_TOKEN` or `GITHUB_TOKEN`, then deliberately set:

```text
GIT_CONFIG_NOSYSTEM=1
GIT_CONFIG_SYSTEM=/dev/null
GIT_CONFIG_GLOBAL=/dev/null
GIT_ATTR_NOSYSTEM=1
GIT_TERMINAL_PROMPT=0
GIT_LFS_SKIP_SMUDGE=1
GIT_NO_REPLACE_OBJECTS=1
GIT_NO_LAZY_FETCH=1
PYTHONDONTWRITEBYTECODE=1
```

Use `git --no-replace-objects` with `core.hooksPath=/dev/null`, `init.templateDir=`, `core.attributesFile=/dev/null`, `protocol.allow=never`, and `protocol.file.allow=always`. Only the existing explicit original RustSec fetch adds `protocol.https.allow=always`; restoration/fsck never enables a network transport. Preserve the existing captured raw fetch stdout/stderr. Do not read or print credential values.

This specifically removes `GIT_SHALLOW_FILE`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_DIR`, `GIT_WORK_TREE` and injected `GIT_CONFIG_*`. Check the clone-owned Git directory is the expected ordinary directory (`database` for bare, `database/.git` for the fresh working clone), not a linked external Git directory. Reject `objects/info/alternates`, `objects/info/http-alternates`, `info/grafts`, unexpected config include directives or partial-clone/promisor setup in the DB. The fresh clone/template rules mean these cannot be imported from hidden artifact files. Never borrow missing objects, enable filters/hooks, or perform a lazy fetch.

After original boundary restoration, require exact HEAD/tree, shallow true, exact boundary bytes, then:

```text
git --no-replace-objects fsck --full --no-reflogs
```

Require exit zero. No diagnostic allowlist, ignored exit 2, `--connectivity-only`, parent fetch, ancestry repair or unconditional history-complete claim. The absent parent named by the exact captured boundary is legitimate; missing/corrupt current tree/blob objects remain failures. Do not add `--strict`, which is a different historical object-format policy. Keep 30-second Git-operation and existing 60-second replay bounds unless measured evidence establishes a separate need to review them.

## Deterministic regressions

The first RED test extends `AdvisoryBundleTests.test_shallow_bundle_survives_visible_only_archive_and_detects_tampering` at `scripts/security/test-audit-native.py:61`: save the real original `db/.git/shallow` bytes, call the existing three-argument retainer, and assert the ordinary sidecar exists and equals them. Current code deterministically fails because that file is absent, before any new function/signature assumption. GREEN must also survive a visible-only ZIP after deleting both origins and original evidence, restore a new private bare DB, retain the exact bytes, report shallow true and pass real full fsck.

Add a separate production-verifier test with a **private loose-object bare repository**, independent of bundle clone rejection. Build a blob, nested tree, root tree, parent commit and child commit using Git `hash-object`, `mktree`, `commit-tree`, `update-ref` and `symbolic-ref`; write the captured child-ID-plus-LF boundary and delete only the parent's loose object. Baseline shared verification passes. Copy the fixture separately, delete a referenced nested tree or leaf blob, and require shared verification to fail while HEAD/root tree/boundary stay identical. No packs/alternates or network supply the missing object; this directly proves fsck behavior.

The cohesive task must also cover:

| Test case                                                                                                      | Required assertion                                                                                              |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Source boundary or advisory worktree drift while HEAD stays equal                                              | Capture blocked; no normalization or inferred boundary.                                                         |
| Missing/empty/wrong/malformed boundary, CRLF, no LF, extra boundary, unsupported full-history DB               | Strict v2 failure; test wrong same-size boundary with correctly recomputed metadata too.                        |
| Wrong digest/size, `True`/float/string types, unknown nested keys/format, duplicate audit JSON keys            | Fail before restore/acceptance.                                                                                 |
| Re-pinned sidecar/bundle and optimistic flags                                                                  | Correct pin alone does not bypass original captured metadata or complete admission equality.                    |
| Missing/duplicate sidecar pin and each original role                                                           | All original 16 remain required; exact minimal v2 payload has 17, TS observation 18.                            |
| Sidecar symlink, path escape, occupied/symlink destination                                                     | Fail without changing the source/caller sentinel or existing repository.                                        |
| `GIT_SHALLOW_FILE`, external object/alternate overrides, injected config, hooks/templates, replacement objects | Valid private verification uses its own bytes/objects; corrupted fixture remains blocked; hook sentinel absent. |
| New policy with clean v1, stripped v2-to-v1, unknown version or missing v2 object                              | Reject without fallback. Never execute old artifact-provided code as a migration tactic.                        |
| Six authority mismatches, dirty/source mismatch, original-path preflight, full candidate historical objects    | Existing failures remain; preflight still precedes malformed DB clone.                                          |
| Whole-result difference, original Python `1.0` bytes, raw scanner semantic faults                              | Preserve complete existing behavior, all four digests/three reports and unchanged bytes.                        |
| Fetch expired or future, including expiry while verification is running                                        | Evaluate the original six-hour rule at complete admission; no cached-time or refreshed timestamp shortcut.      |

No fixture supplies real RustSec, OS trust or distribution evidence. The synthetic Python fixture remains labeled as such and uses actual v2 producer helpers plus complete CLI admission. Old fixture behavior remains available through old authority revisions; new fixture runs do not relabel historical v1 evidence.

## Verification and coordinator boundary

Available locally: Python 3.12.14, Git 2.52.0, Node 24.19.0, pnpm 11.19.0; package pin remains pnpm 11.11.0. Existing dependencies are in the clean `/tmp/openfilm-remaining-issues-20261111` checkout; `/workspace/open-film` has none. Cargo/rustc/rustup are absent on the inspected PATH. No tests were run while drafting.

The companion plan gives exact focused commands. Current CI already runs Python source/audit/admission tests in `.github/workflows/native-security.yml:43`, standalone replay tests in `.github/workflows/ci.yml:237`, and the TS bridge through the media lane (`pnpm test:media`, not the pure-logic contract allowlist). Keep all required exact-head CI checks; fixture success does not establish a fresh source security observation.

Paired contract documentation and the existing upload comment are coordinator-owned follow-through after the cohesive protocol task, before a reviewable branch is complete. Keep historical v1 observation documents intact; add a dated format distinction rather than rewriting them.

A later authorized hosted verification must capture a **new candidate containing this exact v2 authority** with reviewed cargo 1.99.0, cargo-audit 0.22.2, real Linux source/closure/controls and a current original RustSec fetch. Record authenticated run/workflow/artifact IDs and original ZIP digest, review all 17 raw payload roles and new six-file identities, then use identical tools on a fresh runner at `/home/runner/work/open-film/open-film` for full replay before the original six-hour deadline. Retain both actual successful/failed runs and replay bytes, require whole-admission equality and `distributionApproved:false`. A later docs merge can be a separate tool revision only if all six policy files still equal the captured subject. No retry-until-green, old timestamp change or changed-policy replay under the current base's identity is allowed. This planning task performs none of those external actions.
