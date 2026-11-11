# Native candidate evidence binding — issue 140

Status: tooling implemented; real distribution acceptance remains blocked by reviewed runtime inputs, final signed installers, target OS observations and independent review. Fixture tests establish rejection behavior only. Every output has `distributionApproved: false`. A complete record is not a signature, a rights grant, or owner authorization to distribute.

## Version 1 and the signing boundary

The executable contract is `scripts/native/receipt-contract.ts`; the finalizer is `scripts/native/receipt.ts`. All file pins contain `{path, sha256, size}`. Paths are relative to one selected repository/evidence root. Preserve source and build inputs under that root. Do not move mutable artifacts after pinning them.

The graph is acyclic:

```text
reviewed fixed embedded runtime + compiler/installer bytes
  -> candidate.json (native-candidate-identity, incomplete)
  -> signing/packaging -> final-bytes.json (native-final-bytes, incomplete)
  -> candidate-specific security / trust / lifecycle observations
  -> independent review of exact pinned subjects
  -> final external candidate receipt (evidence-complete-record-only)
```

The embedded `runtime-manifest.json` never incorporates shell, installer, or final receipt hashes. Its bytes must remain identical throughout. Candidate identity binds the full source commit, platform, architecture, target triple and ABI, embedded manifest, shell and installer inventory. Signing may change shell/installer hashes, but not their paths/inventory or the runtime manifest. `seal` captures those final bytes. If signing, stapling, repackaging or any other byte change happens afterwards, create a new final-bytes file and repeat all observations/review. Never reuse observations against an old final-artifact digest.

Preserve the original compiler output and Cargo-generated files before signing. Stage the shell/installer copies for signing separately, with the same pre-signing shell hash. Native attribution is recomputed against the original build tree and bound to the pre-trust shell. Final linkage and OS observations cover the post-signing bytes. Review must confirm that signing/packaging is the only intended transition and that the installed shell and embedded manifest match the pinned final identities.

## Commands and input contracts

Run from the candidate checkout after the existing native build:

```sh
pnpm exec tsx scripts/native/receipt.ts
pnpm exec tsx scripts/native/receipt.ts seal . apps/desktop/src-tauri/target/release/bundle/candidate.json apps/desktop/src-tauri/target/release/bundle/final-bytes.json
```

The first command writes an exclusive `candidate.json` in the existing bundle directory, using the runtime linkage baseline ABI and native release executable. The workflow retains both incomplete records, the fixed runtime manifest, runtime SPDX and frontend/service build contributions with its installer archive. It does not invent missing Cargo, platform or review evidence. Default workflow snapshots are unsigned unless the build actually signed them; the incomplete records are not OS trust observations.

For an explicit staged shell (including a signed macOS bundle executable), use:

```sh
pnpm exec tsx scripts/native/receipt.ts identity . dist/native-evidence/identity-inputs.json dist/native-evidence/candidate.json
pnpm exec tsx scripts/native/receipt.ts seal . dist/native-evidence/candidate.json dist/native-evidence/final-bytes.json
pnpm exec tsx scripts/native/receipt.ts finalize . dist/native-evidence/finalization-inputs.json dist/native-evidence/final-candidate.json
```

`identity-inputs.json` contains `candidateSha`, `target` (`platform`, `architecture`, `triple`, `abi`), `runtimeRoot`, `shellPath` and `installerPaths`. `candidateSha` must equal the checkout HEAD. Supported triples are x86_64/aarch64 with unknown-linux-gnu, apple-darwin or pc-windows-msvc. ABI must exactly match reviewed native linkage at finalization.

`finalization-inputs.json` contains `schemaVersion: 1` and file pins named `candidate`, `finalBytes`, `attribution`, `finalLinkagePolicy`, `finalLinkage`, `security`, `trust`, `lifecycle`, `review`. Output files must be new and outside the embedded runtime. These are external local records; no upload occurs.

`attribution` points to an object with `schemaVersion: 1`, root-relative `targetDirectory`, and pins `report`, `spdx`, `buildContributions`, `cargo`, `cargoInputs`, `licenseReceipts`, `nativeRuntimeInputs`, `nativeLinkage`. Reuse `cargo-attribution.ts` and `attribute-distribution.ts` to produce the originals. Retain actual Cargo metadata/messages/invocation/lock, compilations, generated outputs, static-library inventories, Rust sysroot inventory, full license texts and obligations, original linkage, and report notice/receipt copies. Source paths may be relative or absolute inside the selected root; outside-root inputs are rejected. `cargoInputs` pins a version-1 object with `target`, root-relative `targetDirectory`, and file pins `metadata`, `messages`, `lock`, `invocation`, `shell` for the original Cargo collector inputs. The target and original shell must match the candidate, and every role is required. The finalizer reruns `collectCargoEvidence` and compares the entire derived Cargo inventory, including generated outputs and static link directives, before recomputing attribution through the existing contribution validator and compares the report and SPDX, rather than trusting a ready-status string. Any existing blocker fails finalization.

`finalLinkagePolicy` and `finalLinkage` use the existing linkage contract, but binary paths are relative to the selected root and must include the final shell. All listed binary bytes, tool executions, policy identity, target, reviewed OS baseline and ABI must match. This is separate from the pre-signing attribution linkage.

## OS/security observation contract

Each `security`, `trust` or `lifecycle` pin references an object with exactly:

- `schemaVersion: 1`, `kind` matching its role.
- `candidateSha`, `candidateIdentitySha256` (raw candidate.json SHA-256), `finalArtifactsSha256` (from final-bytes.json), and exact `target`.
- `observationMode: "executed"`, `status: "passed"`.
- `observedAt` in `YYYY-MM-DDTHH:mm:ss.sssZ`, `observer`, `tool`, `toolVersion`.
- `checks` and a nonempty `raw` array of pinned actual evidence files.

Required checks:

| Role      | Required check names                                                |
| --------- | ------------------------------------------------------------------- |
| security  | source-admission, post-build-scan, dependency-closure               |
| trust     | signature, publisher, os-trust                                      |
| lifecycle | install, launch, close, reopen, uninstall, original-media-preserved |

Security must include exactly one raw file named `admission.json`, produced by the existing native source-admission workflow for the same candidate. The validator requires passing source remediation, no reasons, all four closure digests and three audit report identities. Retain exactly one each of `source.json`, `closure.json`, `regression.json`, `metadata.json`, `audit.json`, and the stdout/stderr files named by all three audit reports in `security.raw`. Also retain `actual-metadata.stdout`, `current-registry-metadata.stdout`, `current-registry-Cargo.lock`, `historical-Cargo.lock`, and a self-contained `advisory-db.bundle` created from the captured database with `git -C <captured-advisory-db> bundle create <absolute-output>/advisory-db.bundle HEAD`. All these pins are required even if summary flags say they passed. The finalizer materializes the original pinned bytes, reconstructs the database locally from the bundle without network access, and calls the same complete `verify_admission` function as the original native-admission CLI. That includes source checkout cleanliness, exact candidate/lock identity, both metadata graphs, registry and historical locks, captured database commit, raw scans, closure and freshness. The resulting admission must equal the original retained receipt. Original JSON bytes are preserved, including Python floating-point representations. Put evidence and local input configs in an already ignored directory such as `dist/native-evidence`; untracked source files block admission. Replay currently requires Linux, matching the existing source-admission verifier; retain Windows/macOS target observations and perform the final external assembly on Linux with the same candidate source and unchanged artifact bytes. Preserve the complete original source-admission artifact for independent review. Source admission alone does not satisfy the post-build scan or target dependency-closure checks. Security observation must be refreshed within six hours of finalization. Future observation timestamps fail.

OS trust must retain actual Authenticode/SmartScreen or codesign/notarization/Gatekeeper results as applicable, publisher identity, final byte identities and installed embedded-runtime comparison. Physical/interactive prompts and install/close/uninstall behavior must be observed on the declared target. `unavailable`, `not-run`, fixture observations and empty logs cannot be relabeled as passing. Signing credentials and rights are never generated by this tool.

`review` references `schemaVersion: 1`, `kind: "native-candidate-review"`, the same candidate/identity/final-artifact/target fields, `disposition: "reviewed"`, `observationMode: "executed"`, `reviewer`, `reviewedAt`, `subjects`, and nonempty pinned `raw`. `subjects` must exactly equal the eight pins other than review in finalization inputs. The reviewer must differ from the observers, and review must follow every observation. Retain the authenticated review source; this local validator checks bindings and completeness, not the real-world authenticity of an operator's identity or OS log. Distribution authorization remains a separate owner decision.

## Bounds and verification

JSON/raw evidence is limited to 8 MiB per file; shell/installers to 4 GiB each and 8 GiB total, with at most 16 installers. Inputs reject traversal, drive/UNC paths, reserved names, symlinks, hardlinks, stale hashes and sizes. Reads compare the regular-file handle and current path and bound bytes during hashing. Contributions and directory traversal have inventory limits. For this strict boundary, copy contributing package/license files from hardlinked caches into an isolated input tree before finalization; their original paths and hashes remain bound by contribution receipts. Outputs are exclusive; no embedded self-hash or overwrite is allowed.

Tests cover actual temporary files and signed-byte replacement, unchanged runtime manifest, candidate/target mismatch, missing/tampered/oversized/path-abusive evidence, incomplete/fixture observations, independent review subjects, security admission and post-seal artifact mutation. Valid synthetic structure remains record-only and a test-only runtime cannot finalize. Tests do not claim successful Windows/macOS execution or distribution acceptance.
