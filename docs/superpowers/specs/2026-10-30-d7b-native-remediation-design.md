# D7B native remediation design

Status: docs-only design and provenance audit; Alternative A selected by the parent.
No source has been vendored into this repository, no dependency or CI policy has
changed, and no native distribution gate is closed. Parent review of this design
and the private evidence is the next boundary before product implementation.

Base: `1005d381cc2000e0f991fc3e1779ebb2a61cd7ab` (application 0.4.0).
Branch: `codex/v1-d7b-native`. The accepted D7A proposal is recorded at commit
`6c4fac3`, blob `92a0fdb9bfdaed98304662ef51dd1ba0aeb8bdfc`, path
`docs/superpowers/specs/2026-10-30-d7b-native-remediation-proposal.md`;
its SHA-256 is `7eb9a0a5836ae2a26302bf75d75d5bda2575a09960b5840302811f70bcce2025`.
D7A remains separately owned and its full OS evidence remains pending.

## Decision and supported dependency route

Fresh crates.io API responses retrieved on 2026-10-30 confirm the following
stable releases and declared dependency requirements. This is published manifest
evidence, not an executed Cargo resolution or an exhaustive prerelease assessment.

| Current stable crate     | Relevant requirement                                         |
| ------------------------ | ------------------------------------------------------------ |
| Tauri 2.12.5             | GTK `^0.18`, WebKit2GTK `^2`, runtime-wry `~2.12.3`          |
| tauri-runtime-wry 2.12.3 | GTK `^0.18`, WebKit2GTK `=2.0`, Wry `^0.57.0`, Tao `^0.37.0` |
| Wry 0.57.1               | GTK `^0.18`, WebKit2GTK `=2.0.2`                             |
| Tao 0.37.2               | GTK `^0.18`                                                  |
| WebKit2GTK 2.0.2         | GLib/GIO/GDK/GTK and GLib-sys `^0.18.0`                      |
| GTK 0.19.0               | GLib/GIO `^0.22`, GDK `^0.19.0`                              |
| GLib 0.22.10             | Latest stable; 0.18.5 remains the latest 0.18 release        |

Sources: `https://crates.io/api/v1/crates/<name>` and
`https://crates.io/api/v1/crates/<name>/<version>/dependencies`, with names from
the table. GLib 0.18.5 is not yanked. A compatible stable family upgrade has not
been found; upgrading Tauri patch versions does not remove the 0.18 requirement.
Recheck these manifests before implementation. If a supported released family
has changed, resolve and evaluate it before maintaining a backport. Do not force
GLib 0.20 into the current family, migrate to an alpha shell implicitly, or label
modified source as an official 0.18.6 release.

The bounded remediation keeps GLib's version `0.18.5`, preserves the entire
registry crate, and applies only the upstream `VariantStrIter::impl_get` repair.
A Cargo path patch selects that verified tree. Its version remains affected by
RUSTSEC-2024-0429; source-specific evidence must be reported separately.

## Actual provenance audit

Downloaded artifacts and private copies are in `/tmp/openfilm-d7b-provenance/`.
The directory is private (0700), outside all source worktrees. Its
`provenance-report.json`, `pristine-inventory.canonical.json`,
`patched-inventory.canonical.json`, API responses and audit ledger are review
inputs; they are not native execution or independent approval evidence.

| Artifact                                     | SHA-256                                                            |
| -------------------------------------------- | ------------------------------------------------------------------ |
| Authentic `glib-0.18.5.crate` (267679 bytes) | `233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5` |
| Upstream merge `.patch` (1170 bytes)         | `a742bf59f1b00af0f434623b34e2fd969dc8697d37c796efdf909dd9eb19b854` |
| Pristine `src/variant_iter.rs` (9874 bytes)  | `1fd02859333761c45321b32f28b24233446b97d0022a90d3a937ed162585b90e` |
| Patched `src/variant_iter.rs` (9882 bytes)   | `a0f5ee8acb8faa089bcdfbc9a57372609fce7654026ccef7d9a224d05a654ccc` |
| Canonical pristine file inventory/tree       | `2a95cf8a0a2cc534f828c9b6bf78fb9b5ffb41f356608e902144a8da3eb1fc0f` |
| Canonical patched file inventory/tree        | `9e187d4f6bca0afa6c96a9db1dc76e379a2dd26bf3122d82fb928504e3943882` |
| Full `LICENSE` (1024 bytes)                  | `8cf56d10131ce201cf69ab74b111d3ebac1acca3833d7efb39ae357224b70edb` |
| Full `COPYRIGHT` (651 bytes)                 | `dae402989de65164815b7e2b6bc2b9576285434c3785934c8b6ece0fa055960d` |

The archive URL is
`https://static.crates.io/crates/glib/glib-0.18.5.crate`. Its digest matches both
the authentic original application lock and fresh crates.io metadata. All 121
archive members are regular files with mode 0644, beneath `glib-0.18.5/`, totaling
1717584 uncompressed bytes; there are no archive directory or link entries.
`.cargo_vcs_info.json` identifies `42b9caf98e03ded086362d9653ca58fe94dc8658`,
`path_in_vcs: glib`. Preserve that historical metadata unchanged.

The patch URL is
`https://github.com/gtk-rs/gtk-rs-core/commit/05dff0ee696f9bcd8617cd48c4b812d046d440cb.patch`.
GitHub PR 1343 identifies this merge and head
`b5a4071e439bef2b5eea76c3aa25e5ae84839e34`; the patch's `From` line correctly
names that head. The merge's first parent is
`e24f5fcf05b4d78afca97a2b325f3e70cf7cac72`. The API records exactly one changed
file, `glib/src/variant_iter.rs`, fixed Git blob
`e0997f651b103f7b198e528ee41137ad374e19b8`.

The pristine crate file equals the first parent's raw file byte for byte. A
private `patch --batch --fuzz=0 -p2` application produced the fixed commit's raw
file byte for byte, with no other changed file. The exact repair is `let p` to
`let mut p` and `&p` to `&mut p` at the variadic C out argument. No generated
patch, copied example or reconstructed crate substitutes for these artifacts.

Both LICENSE and COPYRIGHT in the original crate equal the same files at the
fixing upstream commit. Cargo declares MIT, and the source header refers to the
repository license. Retain both full notices and all original source headers;
COPYRIGHT retains contributor ownership and refers to version history. It also
explicitly distinguishes the linked GNOME libraries' LGPL/other obligations.
The crate's MIT license is not a license determination for the linked libraries.

### Inventory normalization and future verification boundary

For each regular file, record exactly `path`, `type` (`file`), `mode` (`0644`),
`size` (byte integer), and `sha256`. Strip only the archive's one root component.
Sort entries by relative path encoded as UTF-8 bytes. Encode the array as UTF-8
JSON using sorted object keys, no spaces, no ASCII escaping, followed by one LF.
SHA-256 of those bytes gives the two inventory/tree digests above. There is no
mtime, uid/gid, native path or wall clock in this digest. These are content tree
digests, not Git tree object IDs.

The future verifier must independently hash the archive, patch, every file and
canonical inventories; do not trust a supplied inventory to describe itself.
Reconstruct the expected patched tree from the verified archive and exact patch
inside a private temporary directory, then compare the actual vendored tree.
Require exactly 121 files and exactly the implied parent directories. Reject
extra empty directories, links/hardlinks, special files, unsafe/duplicate/case
colliding paths, extraction escapes, unexpected modes, missing/extra files,
changed notice bytes, altered normalized Cargo metadata, partial patches,
reversed patches, unknown versions and any second code change. Bound archive
members/expanded bytes before extraction. Refuse patch offsets/fuzz or reject
files. No `Cargo.toml.orig` normalization or Cargo-generated checksum file may
be silently added to the code tree.

Place provenance, the original archive, original patch and inventories outside
`vendor/glib-0.18.5/`, under `third-party/glib-0.18.5/`; the vendor tree is exactly
the patched archive content. Its allowed patch provenance files have their own
exact inventory. The reviewed commit anchors the trusted constants; modifying
the verifier and its constants together requires renewed independent review.
A digest comparison cannot defend against an authorized rewrite of that trust
anchor. Linux CI must check actual modes; Windows checkout behavior is not a
substitute for the Linux source check.

## Locked closure, reachability and optimized evidence

The original registry lock is bound to base commit
`1005d381cc2000e0f991fc3e1779ebb2a61cd7ab`, Git blob
`2813c296ae804115ec437b988f0a2e0663fad4c0`, SHA-256
`5fc55ec92fa49659e7ee979a1bfa4a9ca467506cd21532238c68942972926129`.
It last changed in `9a557ec5df6d3951b4d865a47f883e3186951141`.
It resolves Tauri/runtime/runtime-wry 2.12.1, Wry 0.57.0, Tao 0.37.1,
WebKit2GTK/sys 2.0.2, GTK/sys 0.18.2, GDK/sys 0.18.2, GIO 0.18.4,
GIO-sys/GLib-sys 0.18.1, GObject-sys 0.18.0 and GLib/macros 0.18.5.
This is lock parsing; actual target resolution has not run in this audit.

After Cargo regenerates the lock, collect `cargo metadata --locked` filtered to
`x86_64-unknown-linux-gnu` plus target-specific `cargo tree` and a locked native
build. Traverse the resolved root dependencies, including build/dev edges used
by the tests. Require exactly one GLib package ID, version 0.18.5, source null,
and canonical manifest path inside the reviewed vendor root, with the expected
GTK/GIO/sys family. Detect extra registry/Git/path copies and alternate feature
or manifest roots. Review any unrelated lock delta rather than updating the
whole dependency graph. Record source/config/lock hashes before and after the
build; reject out-of-repository Cargo source replacement or injected flags.

A search of OpenFilm's Rust sources at this base found no direct `glib`,
`VariantStrIter` or `array_iter_str` usage. This is not binary reachability proof.
Search the fetched exact locked sources and retain matching package IDs, files,
feature selections and call sites. Absence of a text match does not waive the
remediation. Do not reuse a default-branch upstream search as locked-source proof.

Run five separate optimized probes: `next`, `nth`, `last`, `next_back`,
`nth_back`. Each must consume a genuine nonempty GLib string-array Variant and
assert returned values. Cover UTF-8, empty strings within arrays, empty/exhausted
arrays, in/out-of-range indices and `usize::MAX`, plus mixed forward/backward
consumption. Empty inputs alone never exercise the unsafe call.

Keep the regression source outside the vendored tree. The actual application
integration test uses the same resolved GLib through a Linux-only dev dependency.
For negative controls, copy that same test source to a minimal isolated Cargo
harness with the pristine archived GLib and compatible transitive versions;
for positive controls, use an otherwise identical harness with the reviewed
patched source. Compare their resolved transitive versions/features and report
all differences. Use distinct temporary workspaces and target directories so
Cargo caches or the root patch cannot contaminate the pristine baseline. Also
run the application integration tests against its locked, patched graph.

Use Rust 1.99.0, `--release`, explicit `opt-level=3`, and record LTO/codegen/debug
settings, `rustc -Vv`, target, linker, OS/kernel, package versions and system GLib
version. Build successfully before running a method; each baseline method is a
separate process with timeout, stdout/stderr, signal/exit code and executable
hash. A crash must not suppress the other four probes. A compiler error, missing
library, timeout or arbitrary nonzero status is not reproduction. Baseline
success is reported as `not-reproduced`, never proof of soundness. If expected
optimizer behavior is not reproduced, retain evidence and block automatic
admission pending independent review of an explicit alternate reproduction or
optimizer explanation. Patched success is required for every case.

Local audit host: Debian 13.6; `cargo` and `rustc` are absent from PATH.
`pkg-config` exists but GLib, GIO, GTK3, WebKit2GTK 4.1 and libsoup3 development
packages are absent. No installation or native test was attempted. A subsequent
hosted Ubuntu 24.04 job must install real prerequisites, run the above optimized
controls and the actual locked application build, and retain evidence even when
failing. Existing debug native CI does not satisfy this requirement.

## Raw advisory evidence and source-aware combined admission

Use cargo-audit **0.22.2** and a freshly fetched advisory database at a recorded
Git commit. A planning-time public DB head was
`2295466c4e9df26647fd67d8fa1c705ac2fc7f81`; the GLib advisory fetched at that
commit hashes to `0c1ab1d4a0ebe5948e362728b31613ab588b84a0284dadbc119f7424fdd9c6d0`.
This is advisory metadata, not a cargo-audit report. No scanner has run locally.
The implementation must refresh the database, not reuse this date as freshness.

Retain two raw, unedited `cargo audit --json --deny unsound` outputs with process
exit/stderr, scanner version, DB commit, lock digest and candidate SHA:

1. **Actual resolved path graph:** the newly generated application lock.
2. **Original registry reference:** exact bytes from the original commit/blob
   above, never a synthetic lock with a restored source field. Label this graph
   historical/upstream reference; it is not the currently built graph.

Use the same fresh DB for both scans. Verify the original lock bytes against both
Git blob and SHA-256 before scanning. A source path patch can prevent the advisory
from matching; retain that observation explicitly. Never call omission a clean
version scan. The reference must contain the authentic RUSTSEC-2024-0429 finding
for GLib 0.18.5 with its unsound category and expected affected range. Changed
advisory semantics, missing findings, unknown JSON shape, impossible counts,
DB mismatch, scanner errors or unexpected status all fail closed until reviewed.
Do not infer the scanner's status behavior before capturing it under 0.22.2.

The combined report must keep `upstreamVersionAffected: true` and the complete
raw warning/vulnerability records. It can set `sourceRemediation: verified`
only when archive/patch/tree/closure checks, optimized controls and both raw
report validations succeed for the same candidate. Every other vulnerability
or unsound advisory in either graph fails admission. Report the existing
proc-macro-error 1.0.4 / RUSTSEC-2024-0370 unmaintained notice visibly; it is not
remediated here. Only known non-denied informational categories are nonblocking;
new categories and malformed records are blocked for review.

Capture scanner failures with a supervising process, validate the expected exit
against parsed findings, then compute the combined decision. No `--ignore`,
removed warning records, rewritten version ranges, bare `|| true`, unconditional
success or global continue-on-error is allowed. The expected GLib raw nonzero
result can be accounted for only by the exact independently reviewed source
remediation rule. Until that rule is reviewed, the existing distribution gate
remains blocked. A successful source gate alone does not approve an installer.

## Existing native contract and subsequent increments

These increments remain under the two existing M7E unfinished checkboxes in
`TASKS.md`, plus the existing GLib distribution checkbox. Do not create another
feature queue or mark those boxes complete from this design. The implementation
plan's steps track engineering work, not replacement acceptance gates.

| Existing owner                                      | Observed gap                                                                                                                                             | Concrete increment and evidence                                                                                                                                                                                                   |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GLib distribution gate                              | Security workflow retains warnings but does not deny unsoundness; path filters omit manifests/vendor/verifier                                            | Exact source remediation, closure and optimized probes; raw/reference source-aware gate; relevant PR path triggers and candidate admission dependency                                                                             |
| M7E audited runtime inputs/license review           | `RuntimeInputs.tools` admits only node/ffmpeg/ffprobe/font; no sidecar declaration                                                                       | Add bounded, hash-pinned support-file inputs; preserve reviewed loader-relative locations, reject collisions; inspect recursive imports against explicit OS system allowlist; actual target preflight                             |
| Same M7E checkbox                                   | Current SPDX covers declared components and copied npm dependencies; esbuild/Vite bundled content and compiled Rust have no complete emitted attribution | Emit esbuild/Vite build contribution inventories and target Cargo metadata; reconcile actual shipped JS/native artifacts, complete licenses/NOTICE/source obligations and resulting SPDX relationships                            |
| Same M7E checkbox                                   | Actual reviewed Node/FFmpeg/font/native addons and missing full notices are not supplied                                                                 | Per-platform immutable input receipts; Node 24.14+ on 24.x including bundled notices, FFmpeg configuration/GPL version/source obligations, Noto OFL, fontkit MIT, resvg MPL and Koffi's three MIT notices; fail test-only bundles |
| M7E clean-machine installer/signing/update/rollback | Candidate receipt records installers/runtime hash but lacks final trust evidence and full artifact closure                                               | Record build/source/lock/security/attribution digests, app tree and final installer/archive hashes, explicit signing/notarization status and evidence; keep manual workflow and bundling defaults                                 |
| Same M7E checkbox                                   | No Windows/macOS signing identities, notarization or installer QA observations                                                                           | Add platform trust integration only when real identities exist; sign nested code in supported order, notarize/staple, then hash final bytes; execute candidate-bound clean-machine checklist                                      |
| Same M7E checkbox                                   | Ed25519 verifier is dormant; no downloader/activation/rollback implementation                                                                            | Preserve manual reinstall/rollback contract; add evidence receipt for replacement failure, prior candidate reinstall, schema refusal and project preservation; do not enable automatic updating                                   |

The existing runtime file inventory can represent support files; the new staging
input need not silently change RuntimeManifest v1. Shared sidecars must have
explicit ownership, exact hashes and no conflicting destination. Approved system
imports must identify OS/build/architecture and symbol/ABI baseline. Do not add a
broad loader search path, copy arbitrary host libraries or infer portability from
successful execution on a development runner. A truly portable reviewed tool
build may satisfy the closure without support files, but that is an observed
binary property, not a format assumption.

`stage.ts` already copies full runtime package trees and rejects conflicting npm
versions, while `scripts/build.mjs` bundles additional service and frontend code.
Attribution must distinguish shipped bundles, runtime files, linked native
libraries, build-only packages and external system dependencies. `NOASSERTION`
SPDX fields are not reviewed licensing conclusions. Retain OpenFilm's Apache-2.0
LICENSE/NOTICE and historical grants; do not assign Apache-2.0 to third-party
code. Retain GLib's full MIT notices and linked library obligations. Do not copy
third-party example code without source and license proof.

Default `tauri.conf.json` keeps `bundle.active=false`; only the explicit candidate
configuration bundles. The manual workflow is not formal release publication.
Candidates must retain `not-run` physical gates until actual observations exist.
Signing keys/notarization credentials are not present, and this work creates none.

Follow all eight existing `docs/workstation-qa.md` M7E checks: normal OS trust
without bypass, clean non-admin account without developer tools/fonts, WebView2
and system prerequisites, CJK/space/long paths, first render/decode/reopen,
draft/close/crash ownership, corrupt/incorrect-architecture diagnostics, failed
replacement/manual rollback and uninstall preserving original/managed media,
Named Versions and edits. Bind observations to full candidate/runtime/installer
hashes, OS/build/arch and final signature status. Hosted tests do not close
physical Windows 10/popopc/macOS, Resolve, 4K/GPU, long-session or display gates.

## 2026-10-30 execution amendment: fresh Tokio advisory and three graphs

The preceding audit describes the planning checkpoint. Parent approval of its
provenance/design authorized Tasks 1–4. During implementation, actual
cargo-audit 0.22.2 with a freshly fetched database found
`RUSTSEC-2026-0386` in Tokio 1.53.2 as well as GLib's existing unsoundness.
The parent explicitly approved the minimal, published Tokio 1.53.3 patch
(`MIT`, registry checksum
`ce3335fa71841cda333a58d7615b03901380ecf09d59b3296d21f8bbac0dde4e`).
The crate/API publication and source/license identities are recorded in
`third-party/security/tokio-1.53.3.json`; the observed advisory text is preserved
alongside it. This does not complete emitted native attribution (Task 6).

Cargo 1.99's actual `cargo update -p tokio --precise 1.53.3` also normalized
seven existing dependency choices, without adding/removing any other package or
changing another package version/checksum. The parent reviewed the authentic
crate manifests, exact requirements, target conditions and source digests before
approving only these rows:

| Package/version        | Previous dependency | Current dependency | Declared requirement; target  |
| ---------------------- | ------------------- | ------------------ | ----------------------------- |
| cssparser-macros 0.7.1 | syn 3.0.6           | syn 2.0.119        | `>=2,<4`; all targets         |
| dirs-sys 0.5.0         | windows-sys 0.61.2  | windows-sys 0.59.0 | `>=0.59.0`; Windows           |
| muda 0.20.0            | windows-sys 0.61.2  | windows-sys 0.60.2 | `>=0.60, <=0.61`; Windows     |
| socket2 0.6.5          | windows-sys 0.61.2  | windows-sys 0.60.2 | `>=0.60, <0.62`; Windows      |
| tray-icon 0.25.1       | windows-sys 0.61.2  | windows-sys 0.60.2 | `>=0.60, <=0.61`; Windows     |
| winapi-util 0.1.11     | windows-sys 0.61.2  | windows-sys 0.59.0 | `>=0.48.0, <=0.61.*`; Windows |
| window-vibrancy 0.8.1  | windows-sys 0.61.2  | windows-sys 0.60.2 | `>=0.60, <=0.61`; Windows     |

`third-party/security/cargo-lock-edge-corrections.json` and the exact normalized
Cargo manifests bind the complete old/new dependency lists and package/archive/
manifest identities. The closure verifier pins that receipt; it does not permit
arbitrary edge normalization. Both choices satisfy the downloaded declarations.
An isolated pre-Tokio `cargo metadata --locked` succeeded without rewriting its
lock; its actual active resolution already used syn 2.0.119. This is evidence of
Cargo's resolution/serialization behavior, not proof the historical lock was
invalid or that Windows/macOS native builds have passed. All three OS native
checks and the full Linux build remain required.

The immutable original 1005 registry lock and its raw scan remain historical
reference evidence, including the authentic old Tokio finding. Admission now
requires **three** raw, unedited scans against one freshly fetched DB:

1. The current actual path graph, with Tokio 1.53.3 and the reviewed GLib source.
2. A current registry control generated by actual Cargo in an isolated copy of
   the current application, with only the exact GLib path patch disabled. Compare
   all lock package identities/dependencies and actual Linux metadata/features
   against the path graph, allowing only GLib's path/registry source distinction.
3. The unchanged original 1005 registry graph, still bound to its original Git
   commit/blob/SHA-256. It is never described as the currently built graph.

The current registry control must report exactly the known GLib unsoundness;
the current actual graph must have no other vulnerability or unsound advisory.
The historical graph retains exactly the known GLib and old Tokio findings;
unknown additional findings or changed advisory semantics block review. Keep the
proc-macro-error unmaintained notice visible in every report. Preserve actual
scanner exit status and stderr. A scanner omission never changes
`upstreamVersionAffected: true`. All source, closure, optimized negative/positive/
application controls and fresh audit evidence must bind the same candidate.
Source verification and a minimal Tokio update alone cannot close distribution.

## Scoped runtime/attribution execution provenance — 2026-10-30

Copied with the plan from the separate `codex/v1-d7b-native` documentation
checkpoint (`423ccd3` plus its existing documentation amendments). Parent review
authorized only Tasks 5–6 on `codex/v1-native-runtime-closure`, based on actual
`origin/main` `d5a286ed9250872e8eb9b1c3e40adb926f913d34`. Nothing on this branch
admits the GLib source or runs the stopped security reproduction/control work.
Earlier security observations retain their original context. Full target runtime,
source/license review, native security/build, installer/trust and physical
workstation gates stay open.

### Approved runtime/native attribution DAG clarification

Parent review during Tasks 5–6 confirmed that the final native-shell hash cannot
be included in a receipt hashed by the manifest embedded in that shell. Runtime
receipts bind emitted JS/frontend inputs and copied runtime/tool/npm/license
payloads. Final compiled Rust and native-shell artifact attribution is a separate
post-build receipt, written outside the runtime and awaiting Task 7's candidate
binding. `runtimeReviewStatus` and full `reviewStatus` are separate; neither is a
programmatic distribution approval. Missing native/security/license evidence
continues to block the complete candidate. This amendment preserves a directed
acyclic hash graph and does not claim a fixed-point or self-hash result.
