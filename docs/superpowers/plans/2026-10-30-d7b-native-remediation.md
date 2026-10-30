# D7B Native Remediation Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task by task after the parent provenance/design review. The current instruction forbids further agents, so the skill's alternative delegation workflow does not apply. Steps use checkbox syntax for engineering progress; the existing TASKS.md acceptance checkboxes remain authoritative.

**Goal:** Repair the exact GLib source used by the Linux native application, establish honest source-aware security evidence, and complete the separately gated M7E runtime and candidate evidence increments.

**Architecture:** Preserve authentic GLib 0.18.5 with the exact upstream two-line repair, verify its entire source against the archive, and bind optimized controls and raw advisory reports to the actual locked graph. Extend existing runtime staging, attribution and candidate receipts without creating a new updater or changing default bundling.

**Tech Stack:** Rust 1.99.0, Cargo/cargo-audit 0.22.2, Python 3 standard library, existing Node 24.14+ 24.x/TypeScript tooling, Tauri 2, hosted Ubuntu 24.04 and later target Windows/macOS runners.

**Spec:** [D7B native remediation design](../specs/2026-10-30-d7b-native-remediation-design.md).

## Global constraints

- Begin product work only after parent audit of this docs-only commit and `/tmp/openfilm-d7b-provenance/`; this is the parent's explicit boundary, not a new user permission request.
- Recheck the supported released dependency family before the backport. Keep actual crate version `0.18.5`; no direct 0.20 pin, invented release, source substitution, `--ignore` or unconditional scanner success.
- Archive SHA-256: `233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5`.
- Upstream fix merge: `05dff0ee696f9bcd8617cd48c4b812d046d440cb`; patch SHA-256: `a742bf59f1b00af0f434623b34e2fd969dc8697d37c796efdf909dd9eb19b854`.
- Tree digests, original lock commit/blob/hash and canonical encoding are exactly those in the spec. Preserve all 121 source files, full MIT LICENSE/COPYRIGHT and source headers.
- Always report `upstreamVersionAffected: true`; only verified source evidence can establish `sourceRemediation: verified`. Missing/unknown evidence fails closed.
- Use real Rust 1.99.0 release optimization for all five affected methods with isolated pristine and patched controls. Hosted evidence is not physical workstation evidence.
- Keep `bundle.active=false` by default, manual candidates separate from releases, automatic updates disabled, and synthetic runtime bundles ineligible for distribution.
- Do not modify the D7A/D8 worktrees, run their servers/normal Playwright, install global dependencies, push, open PRs, merge or publish as part of this plan-only task.
- Preserve all other worktrees and main's untracked files. Product execution and future hosted runs occur only in the authorized follow-up scope.

## Review focus

- A plausible-looking edited inventory must not admit unreviewed source: Task 1 tests trusted hashes against independently rebuilt trees.
- A path patch may remove the scanner match: Task 4 tests both actual scanner omission and mandatory original registry evidence.
- An early native abort can conceal other methods: Task 3 supervises each probe separately and rejects incomplete coverage.
- A working developer binary can still omit a required DLL/dylib: Task 5 tests recursive import closure and clean target preflight.
- A candidate can change after signing or combine evidence from different builds: Task 7 tests final-byte hashes and candidate/runtime/security bindings.

---

## File and responsibility map

| Unit                     | Proposed path                                                                    | Responsibility                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Authentic crate source   | `vendor/glib-0.18.5/`                                                            | Only complete patched archive contents                                                                                 |
| Reviewed source inputs   | `third-party/glib-0.18.5/`                                                       | Original archive/patch, canonical inventories, provenance JSON, original registry lock and full provenance explanation |
| Source verifier          | `scripts/security/verify-glib-source.py`                                         | Archive safety, fixed provenance, exact file and tree comparison                                                       |
| Closure verifier         | `scripts/security/verify-glib-closure.py`                                        | Actual Linux metadata/tree/lock source and family admission                                                            |
| Regression source        | `apps/desktop/src-tauri/tests/glib_variant_str_iter.rs`                          | Five affected methods and boundary/mixed-direction cases                                                               |
| Regression supervisor    | `scripts/security/run-glib-controls.py`                                          | Isolated baseline/positive workspaces, process results and complete evidence                                           |
| Audit capture/evaluation | `scripts/security/audit-native.py`, `scripts/security/native-admission.py`       | Raw scanner execution and strict combined decision                                                                     |
| Runtime support files    | Existing `scripts/native/stage.ts`, new `scripts/native/inspect-linkage.py`      | Explicit tool closure and OS import receipts                                                                           |
| Build contributions      | `scripts/build.mjs`, `scripts/build-attribution.mjs`, desktop Vite config        | Bundled service/launcher/frontend package contributions                                                                |
| Distribution attribution | `scripts/native/attribution.ts`                                                  | Target Rust/npm/native/license inventory reconciled to artifacts                                                       |
| Candidate evidence       | Existing `scripts/native/receipt.ts`, new `scripts/native/candidate-evidence.ts` | Final installer/app/runtime/trust/security evidence binding                                                            |

No files in this table are created by the current docs-only audit. Tasks 1–4
form the GLib security increment. Tasks 5–6 refine the first unfinished M7E
checkbox. Tasks 7–8 refine the second. Those later increments receive bounded
review separately; they must not delay or be represented as completed by the
source repair.

### Task 1: Materialize and verify the reviewed source

**Files:** Create `third-party/glib-0.18.5/{glib-0.18.5.crate,upstream-05dff0ee.patch,pristine-inventory.canonical.json,patched-inventory.canonical.json,provenance.json,README.md,original-registry-Cargo.lock}`; create `vendor/glib-0.18.5/`; create `scripts/security/verify-glib-source.py` and `scripts/security/test-verify-glib-source.py`.

**Interfaces:** `verify_source(repository: Path) -> SourceEvidence` returns schemaVersion 1, archive/patch/pristineTree/patchedTree SHA-256, 121 file count, vendor relative path, exact GLib version and `verified: true`, or exits nonzero without a success record. The CLI takes `--repository` and `--output`. No arbitrary expected digest CLI overrides.

- [ ] Refresh the dependency family API evidence; stop backport implementation if a compatible released route needs evaluation. Re-download archive/patch into a private directory and verify against the spec, retaining source URLs and acquisition timestamps.
- [ ] Add fault tests named `test_extra_file`, `test_missing_file`, `test_extra_empty_directory`, `test_source_mutation`, `test_notice_mutation`, `test_inventory_and_source_both_mutated`, `test_symlink`, `test_hardlink`, `test_duplicate_member`, `test_case_collision`, `test_escape_member`, `test_special_file`, `test_wrong_mode`, `test_oversized_archive`, `test_wrong_patch`, `test_partial_patch`, `test_changed_version`. Each must refuse the altered input and never emit `verified: true`; exact approved input must admit 121 files and the pinned patched digest.
- [ ] Run `python3 scripts/security/test-verify-glib-source.py`; initially fail because the verifier is missing. Use temporary fixtures and never mutate the checked-in vendor tree during fault tests.
- [ ] Implement bounded archive validation before extraction, independent canonical inventory generation and exact patch reconstruction. Match all trusted bytes, implied directory names and modes; keep provenance outside the vendor tree. Refuse any patch output indicating offset/fuzz/reject or any extra change. Reject symlinks in traversed parents and hardlinked regular files; do not follow filesystem links.
- [ ] Materialize the complete reviewed source, archive and patch only after parent approval of provenance. Generate `provenance.json` with immutable source IDs, license digests, canonical encoding and all spec hashes; it must not claim independent approval from its own generator. Capture the original lock with `git show 1005d381cc2000e0f991fc3e1779ebb2a61cd7ab:apps/desktop/src-tauri/Cargo.lock`, then check its Git blob and SHA-256.
- [ ] Run fault tests and `python3 scripts/security/verify-glib-source.py --repository . --output <private-output>/source.json`; require all faults refused and exact positive tree admitted. Review the full changed-file inventory and commit `security: preserve and verify exact upstream GLib backport`.

### Task 2: Select and prove the actual Linux closure

**Files:** Modify `apps/desktop/src-tauri/Cargo.toml` and `Cargo.lock`; create `scripts/security/verify-glib-closure.py` and `scripts/security/test-verify-glib-closure.py`.

**Interfaces:** `verify_closure(metadata: dict, lock: bytes, repository: Path, source: SourceEvidence) -> ClosureEvidence` returns schemaVersion 1, target, root package ID, GLib package ID/manifest/features, family package IDs and lock/source/config hashes. CLI takes `--metadata`, `--lock`, `--source`, `--repository`, `--output`; target is fixed to `x86_64-unknown-linux-gnu` for this gate.

- [ ] Add fault fixtures for two GLib versions, duplicate same-version sources, registry source instead of approved path, path escape/link, wrong root/target, missing resolve nodes, foreign GTK/sys family, stale lock hash and an altered vendored file. Every fault must fail; a single expected GLib path and family succeeds.
- [ ] Run `python3 scripts/security/test-verify-glib-closure.py` and observe the missing implementation failure.
- [ ] Add `[patch.crates-io] glib = { path = "../../../vendor/glib-0.18.5" }` at the application manifest root, and a Linux-only dev dependency `glib = "=0.18.5"` for the application regression tests. Regenerate Cargo.lock with Rust 1.99.0; retain version 0.18.5 and review every delta. Do not hand-edit registry checksums into a path package.
- [ ] Implement traversal of the actual metadata resolution. Check all GLib package records as well as the reachable Linux closure; resolve canonical manifest locations and compare root/config/source digests. Record target dependency kinds and feature sets. Scan exact fetched sources for `VariantStrIter` and `array_iter_str`, retaining findings with package identity and explicitly stating the limits of text reachability analysis.
- [ ] On a real Linux host with prerequisites, retain outputs of `cargo +1.99.0 metadata --locked --format-version 1 --filter-platform x86_64-unknown-linux-gnu --manifest-path apps/desktop/src-tauri/Cargo.toml` and `cargo +1.99.0 tree --locked --target x86_64-unknown-linux-gnu --manifest-path apps/desktop/src-tauri/Cargo.toml -e normal,build,dev`. Run the closure verifier, source fault tests and `cargo +1.99.0 build --locked --manifest-path apps/desktop/src-tauri/Cargo.toml`. Require one verified GLib implementation and no unrelated family changes.
- [ ] Record compiler/host/system-library evidence and commit `security: resolve native Linux GLib through verified source`.

### Task 3: Establish optimized negative and positive controls

**Files:** Create `apps/desktop/src-tauri/tests/glib_variant_str_iter.rs`, `scripts/security/run-glib-controls.py`, `scripts/security/test-run-glib-controls.py`.

**Interfaces:** `run_controls(repository: Path, evidence_dir: Path) -> RegressionEvidence` produces schemaVersion 1, candidate/lock/source/harness hashes, compiler/profile/system identity, and per-method baseline/patched/application records containing case, executable digest, exit/signal, timeout, stdout/stderr digests and outcome. Missing methods or uncertain baseline reproduction make `verified` false.

- [ ] Write original OpenFilm tests `glib_next`, `glib_nth`, `glib_last`, `glib_next_back`, `glib_nth_back` using `glib::prelude::ToVariant` and `Variant::array_iter_str`. A nonempty `['first', '繁體中文', '', 'last']` string vector must yield exact expected strings for each method. Test zero/last/past-end/`usize::MAX` indices where applicable, empty/exhausted iterators and `next` then `next_back` then middle consumption. Do not copy upstream test snippets.
- [ ] Add supervisor faults `test_first_abort_does_not_skip_others`, `test_missing_executable`, `test_compile_failure_is_not_reproduction`, `test_timeout_is_not_reproduction`, `test_wrong_source`, `test_shared_target_directory`, `test_transitive_feature_mismatch`, `test_wrong_rust_version`, `test_debug_profile_rejected`, `test_missing_method`, `test_not_reproduced_stays_blocked`, `test_patched_failure_blocks`. Require five records even when the first probe crashes and prohibit verified output on any fault.
- [ ] Run supervisor fault tests, observe missing implementation, then implement private per-control Cargo workspaces and distinct target directories. Copy the same test bytes into each harness; baseline uses the verified pristine archive, positive uses the exact reviewed patched source. Pin their transitive version/features to the application's GLib closure, compare resolved metadata, and reject accidental ambient source patches or flags. Save both control locks and their differences from the application lock.
- [ ] Build with Rust 1.99.0, release opt-level 3 and explicitly recorded LTO=false, codegen-units=16, debug=false, overflow-checks=false and panic=unwind settings. Use Cargo JSON compiler-artifact records to locate the test executable; reject absent or ambiguous test targets. Do not treat `--no-run` as execution.
- [ ] Run each executable with one exact test filter in its own supervised process. Retain raw process evidence. A baseline crash attributable to the null-pointer UB is a reproduced failure; unrelated failures are blocked. If a baseline succeeds, record `not-reproduced` and require independent review of optimizer behavior/alternate reproduction before changing the protocol; never reinterpret it as soundness.
- [ ] Build the actual application test with `cargo +1.99.0 test --locked --release --manifest-path apps/desktop/src-tauri/Cargo.toml --test glib_variant_str_iter --no-run --message-format=json`, then execute all five methods separately against that executable too. Recheck source and lock hashes after execution. All positive/control/application assertions must pass.
- [ ] Run `python3 scripts/security/test-run-glib-controls.py` and `python3 scripts/security/run-glib-controls.py --repository . --output <private-output>` on hosted Ubuntu 24.04 with real packages. Record system GLib and development package versions, compiler verbose identity, executable hashes and every process result; commit `test: verify five GLib iterators under release optimization` only with honest status.

### Task 4: Capture raw audits and enforce source-aware admission

**Files:** Create `scripts/security/audit-native.py`, `scripts/security/native-admission.py`, `scripts/security/test-native-admission.py`; modify `.github/workflows/security.yml`, `.github/workflows/native-installer.yml`, `docs/security-review-2026-10-18.md`, `docs/native-installer.md`, `docs/validation-native-installer.md`; update existing TASKS.md gate wording/evidence links only when warranted.

**Interfaces:** `capture_audits(repository: Path, output: Path) -> AuditEvidence` invokes pinned cargo-audit, fetches one fresh DB, captures raw reports and exits, and verifies lock identity. `evaluate_native(source, closure, regression, audit) -> AdmissionReport` returns schemaVersion 1, candidate SHA, `upstreamVersionAffected: true`, `sourceRemediation: verified|unverified`, `admission: pass|blocked`, reasons and exact evidence digests. Both CLIs take `--repository`/`--output`; evaluation additionally accepts `--evidence-dir`.

- [ ] Install cargo-audit 0.22.2 in the hosted job with the project's Rust 1.99.0. Record `cargo audit --version`; fetch the advisory DB once, record its Git commit, and make both scans use that same local DB without a second update. Save raw `--help`/version output to verify exact supported arguments. Check in no guessed successful report.
- [ ] Capture actual-path and authentic-original-registry reports with `--json --deny unsound`. A supervising subprocess must preserve stdout bytes, stderr and exit status even for expected advisory failure, then invoke evaluation. Bind original lock to the spec's Git commit/blob/SHA-256; never reconstruct it by replacing path source metadata.
- [ ] Write parser/admission fixtures from those observed 0.22.2 outputs, plus synthetic mutations clearly marked as fault fixtures. Pin the supported schema and exit semantics from real observations. Test actual-path GLib omission with a valid registry finding; missing registry finding; changed affected range/category/package; DB mismatch; wrong original blob; stale candidate; malformed/truncated JSON; inconsistent counts/status; nonzero infrastructure failure; unknown category; added vulnerability/unsoundness in either graph; changed tree; incomplete probes; and preserved RUSTSEC-2024-0370 warning. Every unknown or mismatched case blocks; valid source remediation keeps `upstreamVersionAffected: true` and retains both raw reports.
- [ ] Run `python3 scripts/security/test-native-admission.py` red, implement strict parsing and combined evaluation, then require green. A legitimate GLib raw failure is explained only by the verified source rule; no `--ignore`, generic warning filtering, ignored process status or unconditional success.
- [ ] Extend security PR path triggers for Cargo manifests/lock, toolchain, vendor/provenance inputs, source/closure/regression/audit scripts/tests and workflow changes. Install actual GTK/WebKit prerequisites in the optimized evidence job. Upload raw/source/closure/control/audit/admission files with `if: always()` and require evidence files; upload does not convert failure to success.
- [ ] Make manual native candidates run or consume validated security admission for the exact checkout, actual Linux closure and fresh DB under the reviewed protocol. Require source verification before the native build. Candidate workflow remains manual, and security success alone does not grant release distribution.
- [ ] Review the fresh report jointly with provenance/optimized evidence. Only after independent acceptance of this source rule may the existing GLib gate be described as source-remediated; retain the upstream version warning explicitly. Commit `security: gate native candidates on verified source and raw audits`.

### Task 5: Complete explicit runtime tool/library inputs

**Owner:** Existing M7E checkbox, “Complete audited per-platform runtime inputs and license/dependency review.”

**Files:** Modify `scripts/native/stage.ts`, `docs/native-installer.md`, `tests/unit/runtime-manifest.test.ts`, `tests/integration/native-runtime.test.ts`; create `scripts/native/inspect-linkage.py` and `scripts/native/test-inspect-linkage.py`. Modify launcher/Rust validation only if tests expose a contract requirement; do not broaden dynamic loader environment implicitly.

**Interfaces:** Extend staging `InputFile` with optional `supportFiles: ToolSupportFile[]`, where `ToolSupportFile` has `id`, `source`, safe relative `destination`, `sha256`, `version`, `license`, `licenseFile`, `licenseSha256`, `executable`. Components use unique `tool:<tool>:<id>` IDs. `inspect_linkage(root: Path, policy: dict) -> LinkageEvidence` reports target/OS baseline, all recursive imported libraries, resolved bundled destinations, reviewed system imports and tool identity. The policy is hash-covered by the distribution receipt.

- [ ] Add staging faults for missing/wrong-hash sidecars, traversal/link/case collision, duplicate shared destination, missing full notice and incorrect architecture. A synthetic tool with a declared support file must include it and its notice in the manifest; unknown or conflicting destination must fail. Keep test-only receipts rejected by installer admission.
- [ ] Add linkage parser fixtures for ELF, PE and Mach-O import output, including unresolved imports, absolute developer paths, wrong architecture, unapproved system import and a recursively missing dependency. Each rejects; explicitly approved system imports and fully declared adjacent sidecars pass.
- [ ] Implement bounded support-file copying through existing exclusive/hash-verified stage operations, preserving reviewed loader-relative layout. Extend component/license inventory without changing RuntimeManifest v1 semantics. Inspect actual binaries via target tools (`readelf`, `dumpbin`, `otool`) with literal argument arrays; retain raw outputs and tool versions. Validate architecture and recursive closure against the reviewed OS policy, not the host's accidental search path.
- [ ] Run focused runtime unit/staging tests and `python3 scripts/native/test-inspect-linkage.py`. Perform preflight on each actual supported OS/architecture with pinned reviewed Node 24.x 24.14+, FFmpeg/FFprobe/font inputs and native npm addons. A portable tool build may need no support files only when the actual linkage evidence proves that property.
- [ ] Obtain real full Node bundled notices, font/OFL notices, FFmpeg build configuration/GPL version and corresponding-source/source-offer evidence, and missing fontkit/brotli/dfa/resvg notices. Review binary and notice digests together. Commit `native: declare and verify runtime tool library closure`; leave the M7E box open until all supported targets are audited.

### Task 6: Reconcile shipped code and license/SBOM closure

**Owner:** Same M7E audited inputs/license checkbox.

**Files:** Modify `scripts/build.mjs`, `apps/desktop/vite.config.ts`, `scripts/native/stage.ts`; create `scripts/build-attribution.mjs`, `scripts/native/attribution.ts`, `tests/unit/native-attribution.test.ts`; update `docs/native-installer.md` and preserve existing `LICENSE`, `NOTICE`, `LICENSES/` grants.

**Interfaces:** `BuildContributions` schemaVersion 1 contains artifact relative path/SHA-256 and package name/version/source identity for modules contributing to that artifact. `createDistributionAttribution(buildContributions, cargoMetadata, runtimeManifest, licenseReceipts) -> AttributionEvidence` maps contributions to shipped package/license texts, compiled Rust/native dependencies, external system requirements and SPDX relationships; missing/unknown attribution blocks review.

- [ ] Add faults for a bundled JS package omitted from runtime packages, a compiled Rust package omitted from SPDX, missing full notice, changed package/source identity, stale output hash, absent sidecar obligation and incomplete FFmpeg/MPL/source receipt. Assert build-only tools are distinguished from included code, and full Koffi notices/OpenFilm grants survive.
- [ ] Enable esbuild metafiles for service and launcher builds; add a Vite build plugin that records actual emitted chunks' module contributions. Map canonical package roots back to exact frozen package identities and fail unresolved third-party contributors. Do not infer bundle contents from the whole pnpm lock or present optional unshipped code as shipped.
- [ ] Reconcile target Cargo metadata/build artifact evidence with the native shell and linked libraries; distinguish compiled target code, build/proc-macro inputs, platform-inactive packages and external OS libraries. Review generated or embedded build outputs for attribution obligations. Record provenance for all copied source/license text; unknown identity/license remains a blocked review item.
- [ ] Generate hash-covered complete notice texts and artifact-bound SPDX package/file/dependency relationships. The runtime manifest must include these receipts without a digest cycle: contribution records hash payload artifacts; manifest hashes receipts; final candidate receipt hashes manifest. Do not treat `NOASSERTION` as a license approval.
- [ ] Run `pnpm exec vitest run tests/unit/native-attribution.test.ts tests/unit/runtime-manifest.test.ts`, build the candidate artifacts, compare every contribution against actual emitted bytes, and review corresponding-source obligations before marking any target reviewed. Commit `native: account for shipped frontend service and Rust licenses`.

### Task 7: Bind manual candidates to final bytes and trust status

**Owner:** Existing M7E checkbox, “Obtain Windows/macOS clean-machine installer, first-run, signing/notarization, update and rollback evidence before distributing native installers.”

**Files:** Modify `scripts/native/receipt.ts`, `.github/workflows/native-installer.yml`, `docs/native-installer.md`; create `scripts/native/candidate-evidence.ts`, `tests/unit/native-candidate-evidence.test.ts`. Preserve default `tauri.conf.json` and manual update policy.

**Interfaces:** `CandidateEvidence` schemaVersion 1 includes full candidate commit, source/lock/runtime/security/attribution digests, OS/build/arch, installer and app-tree identities, final archive hash reference, signature/notarization status (`not-configured|verified|failed`), and workstation states. `validateCandidateEvidence(evidence, files) -> void` throws on inconsistency; it does not infer trust from a checksum.

- [ ] Add faults for post-sign byte changes, stale runtime/security/attribution receipt, omitted .app content, incorrect archive hash, mismatched OS/arch/candidate, unsigned artifact labeled verified, missing notarization evidence and fabricated workstation pass. Keep manual candidates explicitly non-release when trust/manual gates are missing.
- [ ] Extend current receipt logic, which hashes recognized installer files and skips .app trees, to record a bounded canonical app-tree identity with safe bundle-link handling. Bind source/admission/attribution/runtime evidence. Preserve final transport archive digest in an external receipt to avoid hashing the receipt into itself.
- [ ] Leave signing/notarization `not-configured` when identities are absent. When real identities become available in a separately reviewed platform configuration, verify signing of nested code, normal OS verification, notarization/stapling and final trust records; generate artifact receipts only after final mutation. Do not create keys or pretend signing occurred.
- [ ] Run focused candidate receipt and existing archive transport tests. Dispatch a candidate only with reviewed target inputs and exact bound security evidence; upload receipts and raw trust output. Keep `workstationQA: not-run` unless separate actual observations exist. Commit `native: bind candidate receipts to final artifacts and evidence`.

### Task 8: Record manual installation, replacement and rollback evidence

**Owner:** Same existing M7E clean-machine checkbox; this is evidence work after real candidates exist.

**Files:** Modify `docs/workstation-qa.md`, `docs/validation-native-installer.md` and existing TASKS.md evidence links; create `scripts/native/workstation-evidence.ts` and `tests/unit/native-workstation-evidence.test.ts` only when implementing the structured receipt validator. Do not modify `apps/server/src/runtime-update.ts` to activate updates.

**Interfaces:** `WorkstationEvidence` binds candidate, runtime, installer hashes, OS/build/arch and signature state to eight checklist result records (`not-run|passed|failed`) with evidence references and observation time. `validateWorkstationEvidence(value, candidate) -> void` refuses missing evidence or mismatched identity; validation alone cannot create a passed observation.

- [ ] Test refusal of a pass without observations, wrong installer/runtime identity, missing failed-replacement/manual-rollback case, and project-preservation claims without before/after hashes. Preserve honest `not-run` states and normal unsigned-candidate limitations.
- [ ] Execute all eight existing M7E checklist cases on actual clean target Windows/macOS systems through the normal supported trust flow without bypass. Include non-admin/no-developer-tool startup, WebView2/system prerequisites, paths, rendering/reopen, owned close/crash, corrupt runtime, failed replacement, prior verified candidate reinstall and uninstall preservation.
- [ ] Confirm manual rollback refuses unsupported newer schemas without implicit project downgrade. Record original/managed-media/snapshot/edit before/after evidence; automatic updates stay disabled. A clean VM can support installer observations but does not prove physical display/GPU/camera/long-session gates.
- [ ] Bind and review receipts. Update only the existing authoritative checkbox when its complete acceptance evidence is present. Otherwise document the exact unresolved OS/signing/input/evidence dependency without claiming v1 native release approval.

## Handoff and current validation

The present task stops after the two Markdown files are formatted, diff-checked
and committed for parent review. Its only executable investigation is public
metadata retrieval, private authentic source/notice/patch hashing and inventory
comparison. No source verifier, native regression, cargo-audit report, runtime
bundle, installer, signing result or workstation result has been produced by
this planning task. Local Rust/native prerequisites are absent. Do not reuse old
D7A/D7B proposal results as new optimized or full OS evidence.

## 2026-10-30 approved execution amendment (Tasks 1–4)

Parent provenance/design audit approved implementation. A fresh real scan exposed
Tokio 1.53.2 / RUSTSEC-2026-0386. Apply only the real Cargo-generated Tokio 1.53.3
patch plus the seven explicitly reviewed edge normalizations in the design's
execution amendment. Pin their complete dependency lists and authentic source/
manifest hashes; mutations and any eighth edge change must fail the closure
check. Preserve the exact 1005 registry reference and all original evidence.

Task 4 additionally generates a **current** registry control using real Cargo
with only the GLib path patch disabled. Require graph/version/feature equality
with the actual candidate except GLib source, retain its real manifest/lock and
scan it with the same fresh DB as the actual and historical graphs. Current
registry admits only known GLib unsoundness, actual admits no additional unsound/
vulnerability, historical retains the known GLib and old Tokio findings.
Validate all three raw reports, process statuses and identities; missing or
mismatched controls block. This amendment was independently reviewed by the
parent; no historical version, original lock or raw finding is rewritten.

## Scoped execution amendment — runtime closure and attribution, 2026-10-30

This file and its design were copied without rewriting their earlier provenance
from `codex/v1-d7b-native` (docs at commit `423ccd3`, with the existing execution
amendments) into `codex/v1-native-runtime-closure`, based on actual `origin/main`
`d5a286ed9250872e8eb9b1c3e40adb926f913d34`. The parent reviewed and approved
**Tasks 5–6 only** for this branch. Earlier task descriptions and evidence remain
historical context, not execution authority or security approval here.

Implement standard packaging, source/receipt attribution, focused tests and the
regular build. Do not run vulnerability/crash/debugger reproduction or controls,
and do not bypass the earlier stopped source-admission action. GLib's existing
distribution blocker, complete target runtime audits, native builds, signing,
installer and physical workstation gates remain open. Root performs the final
independent review; this executor does not push, create a PR or merge.

### Parent-approved artifact DAG clarification

The native shell embeds the runtime manifest SHA-256. Therefore a final shell
hash or a receipt containing that hash **cannot** be written into that same
manifest's inventory. The parent explicitly approved this no-cycle amendment:

1. Emitted JavaScript/frontend contribution records hash their payload bytes.
2. RuntimeManifest v1 hashes runtime/tool/npm/license and runtime-attribution
   receipts; `runtimeReviewStatus` applies only to those inputs.
3. After the actual shell build, `attribute-distribution.ts` writes separate
   compiled-Rust/native-shell/license/SPDX evidence outside the runtime tree.
   `reviewStatus` remains blocked when actual native evidence or attribution is
   missing, even if the runtime portion is reviewed.
4. Task 7's future candidate evidence must bind both the existing manifest and
   this external receipt, plus final installer/archive/trust/security evidence.

Neither receipt hashes itself. Runtime-only or JavaScript success cannot close
M7E, GLib, full native/security, signing, installer, or workstation gates.
