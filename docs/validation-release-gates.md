# Stable release gates: current audit

Audit date: 2026-11-14. Pre-PR #163 evidence baseline: merged main
[`9b8df866134e12e864d642005c46231b41d9da53`](https://github.com/bynanci/open-film/commit/9b8df866134e12e864d642005c46231b41d9da53).
Source-only branch candidate: `54534d8cf985203e8b5abbd09a771436f8fe09e5`,
merged by PR #129 to `release/v0.5.0` at
`1b8d386e2a68b2448d20742138b4b100c799289b`. This audit records technical
readiness and remaining gates; it is not a tag or release approval. Source
delivery, native installers and physical claims
have distinct gates under the [release train](roadmap/incremental-release-train.md).

Post-audit update, 2026-11-14 16:22 UTC: PR #163 merged to main at
[`a335b09`](https://github.com/bynanci/open-film/commit/a335b09cd766c3b53926360c713e0b24ce6294ce).
Its exact PR head `23f9642` passed all 20 hosted checks. Post-merge Verify
([43615235479](https://github.com/bynanci/open-film/actions/runs/43615235479)),
Windows recovery
([43615235406](https://github.com/bynanci/open-film/actions/runs/43615235406))
and Render QA
([43615235307](https://github.com/bynanci/open-film/actions/runs/43615235307))
were in progress at that update; Pages passed
([43615235320](https://github.com/bynanci/open-film/actions/runs/43615235320)).

![Release gates: freeze one candidate, pass source and security gates, add platform-specific checks for the distribution and claims, then approve and verify published artifacts.](images/release-gates.svg)

![Source candidate 54534d8 is merged to the v0.5.0 release branch; no tag or publication exists. Native installer and workstation gates remain open.](images/release-gate-evidence.svg)

## Candidate-bound evidence

- **Development repair.** PR [#128](https://github.com/bynanci/open-film/pull/128)
  merged at `23ac0a22a500b4454449da56436305c5c41292cc`. Its final head
  `e11051f01bf8603c5bacbcb34e6d8cb6e2352bbf` passed all 19 checks, including
  [Verify 42493069308](https://github.com/bynanci/open-film/actions/runs/42493069308),
  [native source admission 42493069303](https://github.com/bynanci/open-film/actions/runs/42493069303),
  Windows Recovery, DCO and three-platform Render QA. The
  [independent technical disposition](security/glib-0429-independent-review.md)
  retains source, closure, optimized controls and fresh audit evidence. Main's
  post-merge Windows Recovery/Render QA/Pages passed. Its
  [Verify 42494577085](https://github.com/bynanci/open-film/actions/runs/42494577085)
  completed successfully on `main@23ac0a22a500b4454449da56436305c5c41292cc`
  on 2026-11-08. This historical run does not replace the release candidate's
  own checks or the later `main@9b8df866` results below.
- **v0.5.0 source candidate.** PR
  [#129](https://github.com/bynanci/open-film/pull/129), whose base was
  `release/v0.5.0` at `d5a286ed9250872e8eb9b1c3e40adb926f913d34`, has candidate
  PR head `54534d8cf985203e8b5abbd09a771436f8fe09e5`. GitHub merged it as
  `1b8d386e2a68b2448d20742138b4b100c799289b`, the current
  `release/v0.5.0` branch head. It carries only the reviewed GLib
  fix/admission backport over its prior candidate; all 431 package versions
  remain fixed and all 22 version surfaces agree on 0.5.0. Exact-head
  [Verify 42493427242](https://github.com/bynanci/open-film/actions/runs/42493427242),
  [security/native admission 42493427131](https://github.com/bynanci/open-film/actions/runs/42493427131),
  [Windows Recovery 42493427121](https://github.com/bynanci/open-film/actions/runs/42493427121),
  [DCO 42493424466](https://github.com/bynanci/open-film/actions/runs/42493424466)
  and [Render QA 42493427234](https://github.com/bynanci/open-film/actions/runs/42493427234)
  all passed. Independently downloaded browser reports validate 313 passing
  cases with no skip/retry. Render reports validate 57 tests per platform,
  180 decoded frames, PTS/RGB/AAC/source hashes and `workstationVerified: false`.
- **Independent release-source disposition.** The adapted 0.5.0 source received
  an independent AI technical **PASS**, with no confirmed P0/P1/P2 finding.
  The [retained proof](https://github.com/bynanci/open-film/blob/main/docs/evidence/releases/v0.5.0-security-review.json)
  binds the candidate and its newly authenticated native artifact 13623121108
  (ZIP SHA-256 `e34686d33068c3eb202c952b03e672281558c8df4345b6d056c0d088d16b76cc`).
  Actual optimized pristine failures, patched/application passes, native build
  and fresh actual/registry/historical audit exits 0/1/1 are verified. A path
  crate's default scanner omission is not accepted as remediation proof.
- **Owner review inputs.** The historical owner packet records source archive
  SHA-256
  `40e170e682c1a518f16a572edddf0260247293c846986bd827582ba9b825e458`.
  The [owner review](release-owner-review-v050.md) names the exact scope, assets,
  checks and branch-only maintenance-warning decision. The later archive-byte
  reproduction differed; all 1,417 tracked Git-tree file contents matched.
  Neither source archive hash is approved as a published asset.
- **Published state.** Latest public release remains source-only
  [v0.4.0](https://github.com/bynanci/open-film/releases/tag/v0.4.0), published
  2026-10-20. Main package metadata remains 1.0.0; that is not a published tag.
- **Main after PRs #161/#162.** Exact head
  `9b8df866134e12e864d642005c46231b41d9da53` passed Verify
  [43577698735](https://github.com/bynanci/open-film/actions/runs/43577698735)
  (11/11 jobs), Windows Recovery
  [43577698778](https://github.com/bynanci/open-film/actions/runs/43577698778),
  Render QA [43577698703](https://github.com/bynanci/open-film/actions/runs/43577698703)
  (Linux/Windows/macOS and strict aggregate), and Pages
  [43577698719](https://github.com/bynanci/open-film/actions/runs/43577698719).
  These are hosted checks, not physical listening or workstation acceptance.

- **Native receipt code integrated; candidate acceptance open.** PR
  [#163](https://github.com/bynanci/open-film/pull/163), head
  `23f9642ea542dbc515e4244c8f331ffa0652492c`, merged as main commit `a335b09`,
  captures the exact Tauri Cargo invocation and build inputs for Issue #140.
  All 20 exact-head hosted checks passed. The partial local `pnpm test` run at
  main `86afec8` was interrupted after about 25 minutes during an environment
  transition. Its preserved log shows one timeout in
  `tests/integration/native-runtime.test.ts`: the failed-close/fresh-start case
  took 30.124 seconds against its unchanged 30-second budget. The 30-test
  `native-benchmark-runner.test.ts` file passed. No final Vitest summary, exit
  code or failure stack was captured. One unmodified isolated rerun passed in
  21.682 seconds (28.241-second wrapper, no retry); this does not establish the
  cause or a full-suite pass. Later main `8604af87` Verify passed
  ([43619739468](https://github.com/bynanci/open-film/actions/runs/43619739468)).
  No native installer workflow run or candidate-bound receipt exists.

## Gate state and limits

| Gate                                                          | Current state                                                                                                                   | Consequence                                                                                                                                                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Candidate identity/version/source checks                      | PASS for 54534d8                                                                                                                | Branch update complete; no tag approval                                                                                                                                                               |
| GLib RUSTSEC-2024-0429                                        | Exact source repair technically verified on main and 0.5.0 candidate                                                            | Upstream 0.18.5 remains affected; retain source-aware proof and registry controls                                                                                                                     |
| proc-macro-error RUSTSEC-2024-0370                            | Maintenance warning retained; branch-only disposition recorded                                                                  | Recheck by 2026-12-08 or on source/lock/features/toolchain/advisory change; no binary acceptance                                                                                                      |
| Release-owner decision and release-branch merge               | Source-only branch merge approved and complete                                                                                  | No tag, publication, installer or distribution approval                                                                                                                                               |
| Audited native runtime, licenses/SBOM and installer artifacts | Missing; native installer workflow has no candidate runs                                                                        | Native distribution blocked                                                                                                                                                                           |
| Signing/notarization and clean target lifecycle               | Not verified                                                                                                                    | No signed installer/update/rollback claim                                                                                                                                                             |
| Windows/macOS physical QA                                     | No connected workstation or candidate-bound observations                                                                        | Keep gates not-run; record schema 1.1 does not supply observations                                                                                                                                    |
| Repository alert/protection/signing-secret administration     | Branch API reports `protected: false`; Rulesets API is empty; classic protection and secrets metadata are restricted (HTTP 403) | Approved ruleset has not been applied; prior POST returned 403. An authorized administrator must recheck/apply the fixed proposal and capture effective rules, rule ID, alerts and role attestations. |

The v0.5.0 source-only candidate branch update is complete. Its technical gates
passed, and the owner approved that branch merge with the maintenance-warning
disposition limited to the branch update. The compressed source archive digest
did not reproduce byte-for-byte in the later environment, although all 1,417
Git-tree file contents matched; neither archive is approved as a published
asset. There is no tag or GitHub Release. Signed Windows/macOS installers are
a separate M7E objective.
Resolve, GPU/4K, real camera/external media and listening claims remain under
[Issue #7](https://github.com/bynanci/open-film/issues/7).

## Proposed release policy

### Gate 1: freeze the release identity

- Follow the staged sequence in the
  [release train](roadmap/incremental-release-train.md). v0.5.0 is the planned
  first stage; it is not approved until its candidate is frozen and passes these
  gates. v1.0.0 remains a later distribution objective.
- Freeze one full source SHA. Record the matching tag, all app/package/Tauri/Cargo
  version fields, project schema/catalog compatibility, and dependency lock hashes.
- Require all release code to be merged, reviewed and present at that exact SHA.
  Record the changelog, supported platform scope and known limitations.
- Never copy a check result from an earlier commit into the candidate record.

### Gate 2: pass source-release checks

- Require the full exact-SHA Verify lanes: format, i18n/docs checks, lint, types,
  contract tests, real media tests, all browser shards, build, interchange, native
  CI, render matrix and Windows recovery where applicable.
- No unresolved P0/P1 correctness or data-loss issue. Failed, cancelled, skipped,
  timed-out or uncollected checks are not passes.
- Exercise project open/save/reopen, supported schema migration, source hashes,
  Undo/Redo and export on synthetic fixtures. Preserve the existing project and
  composition contracts.
- Review license/NOTICE, DCO, source obligations, runtime inventory and SBOM.
  Bind each report to the candidate and lockfile hashes.
- Run JavaScript and RustSec audits on the candidate using a fresh advisory
  database. Known vulnerabilities block release. Unsound advisories require
  remediation or an independently reviewed, target-specific reachability decision
  with an owner, rationale, expiry and recheck trigger. A default scanner exit 0
  cannot silently waive these findings.

### Gate 3: add checks for the distribution

For source-only publication, state clearly that no signed native installer is
included. For each installer platform that is advertised:

- Build from the frozen candidate with reviewed, hash-pinned runtime inputs,
  complete license/source notices and an SBOM.
- Verify the package and runtime hashes. Obtain actual Windows signing or macOS
  signing/notarization receipts where those trust channels are claimed.
- Install as a non-administrator on a clean machine without developer Node,
  FFmpeg, fonts or Perl on PATH. Cover CJK and long paths, first launch, import,
  render, decode, save and reopen.
- Exercise supported update, failed replacement, rollback and uninstall. Verify
  that projects, original media and named versions remain intact.
- Record candidate SHA, package/runtime hashes, OS/build, architecture, tool
  versions, tester, timestamp, result and evidence references.

### Gate 4: bind special claims to real evidence

Physical workstation claims are conditional gates, not generic source CI.
Use the [workstation QA record](workstation-qa.md) and Issue #7 for Windows,
macOS, external volumes, Resolve roundtrip, displays, GPU/4K and audio listening.
If a gate is not run, mark the corresponding claim unsupported or unverified.
Mocks and generated fixtures cannot close hardware or human-quality gates.

### Gate 5: approve and publish

- A release owner reviews the exact candidate, all hard gates, explicit exceptions
  and release notes. Exceptions need a named owner, scope, rationale, expiry and
  next review date; they cannot relabel a failed or not-run gate as passed.
- Publish immutable source/package artifacts with SHA-256 receipts and the
  candidate-bound validation manifest. Keep evidence available beyond short-lived
  CI artifact retention.
- After publication, download the public assets, verify every checksum, confirm
  tag/commit/version agreement and record the final release URL and timestamp.

## Next actions

1. Keep the source-only branch candidate separate from publication. Any asset preparation requires a fresh exact-byte review, current advisory admission and explicit release authorization.
2. Preserve the source-aware GLib review, raw audit/control evidence and all asset hashes beyond temporary CI retention. Re-audit on changed sources, locks, features, compilers, targets, advisories or candidate SHA.
3. Obtain reviewed per-target runtime inputs, full distribution license/source/SBOM closure and a candidate-bound native receipt before dispatching installer packaging.
4. Connect the actual Windows/macOS targets and collect signing/notarization, clean install, first launch, update failure, rollback, uninstall and project-preservation observations using the existing [M7E checklist](workstation-qa.md#m7e-native-installer-candidate).
5. Ask an authorized administrator to apply the already-approved fixed ruleset only after rechecking its exact hash against current policy; verify the returned rule ID and safe controls. Alerting, signing and release-role attestations remain required. A 403 is not authority to bypass the approved procedure.

## Sources

- [Current tasks](https://github.com/bynanci/open-film/blob/main/TASKS.md), [roadmap](https://github.com/bynanci/open-film/blob/main/ROADMAP.md) and [release train](roadmap/incremental-release-train.md).
- [Independent main GLib disposition](security/glib-0429-independent-review.md) and [0.5.0 owner review](release-owner-review-v050.md).
- [Native installer validation](validation-native-installer.md), [workstation checklist](workstation-qa.md) and [historical v0.4.0 validation](validation-stable-release.md).

## 2026-11-11 backlog reconciliation

The [current issue plan](roadmap/next-issues-2026-11-11.md) audits main `08e38b6` and
Storytelling snapshot `b7fcf86`. It separates accepted bounded SDK scopes from
production M3-03, identifies final native candidate evidence binding as code work,
and preserves owner and physical acceptance as open gates. The dated records
above keep their original source/measurement identities; no publication is
approved by this update.
