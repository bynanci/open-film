# Runtime intake and target staging — issue 141

Status on 2026-11-11: **partial delivery; runtime distribution remains blocked**.
The checked-in [upstream evidence](evidence/runtime-intake-141/upstream-evidence.json)
records actual bytes fetched over HTTPS and inspected without executing payloads.
It is an intake inventory, not an SPDX distribution document, independent license
approval, or target execution receipt. No runtime artifact/run ID or independently
reviewed runtime-manifest digest exists from this work.

## Observed inputs

| Component                             | Actual evidence retained                                                                                                                                                                                  | Remaining review                                                                                                                                                                                             |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Node 24.14.0, Windows x64             | Official ZIP and `node.exe`, full bundled LICENSE, SHA-256 matched to official SHASUMS                                                                                                                    | Release signature validation; Windows build/OS baseline and target execution                                                                                                                                 |
| Node 24.14.0, macOS arm64             | Official tar.xz and `bin/node`, LICENSE and `include/node/config.gypi`; official checksum matched; module ABI 137, N-API 10 observed                                                                      | Release signature validation; deployment baseline/linkage and target execution                                                                                                                               |
| Node source                           | Official source tar.xz checksum matched; tag resolves to `f657bb8ed86365ff3fdbe32e27563e778b41486a`                                                                                                       | Review complete bundled third-party notices and applicable source obligations                                                                                                                                |
| Koffi 3.3.3                           | Core and Windows x64/macOS arm64 addon tarballs match frozen lockfile SHA-512; actual `.node` SHA-256 and PE/Mach-O headers; core declares N-API 8; all three stage-pinned MIT notices retained           | Actual target loader/linkage and complete source/build provenance review                                                                                                                                     |
| resvg 2.6.2                           | Core and both target addon tarballs match frozen lockfile; actual addon hashes/headers; source archive at registry gitHead `9ca058462ac529120c8cc84ddcd6fef644cc5406`                                     | MPL-2.0 source disclosure and transitive compiled contribution/license closure; exact ABI/baseline                                                                                                           |
| Noto Sans CJK TC 2.004                | Unmodified OTF and full OFL text from commit `523d033d6cb47f4a80c58a35753646f5c3608a78`                                                                                                                   | Copyright/reserved-name and bundling review; actual CJK rasterization with selected resvg/fontkit                                                                                                            |
| FFmpeg/FFprobe 7.1.1 source candidate | Official ffmpeg.org tar/signature endpoints returned HTTP 503; source fetched from upstream GitHub commit `db69d06eeeab4f46da15030a80d539efb4503ca8`, including actual license texts and configure source | **No target executable selected.** Exact binary/configuration, libx264/AAC features, recursive imports, GPL/LGPL source/relink obligations, external codec licenses and source correspondence remain missing |

The font candidate is an OTF. Existing staging calls its destination `default.ttf`;
actual font decoding/rasterization, rather than the suffix, must establish support.
A source snapshot or package license field does not approve a binary's complete
redistribution obligations. FFmpeg 7.1.1 is a source candidate, not a promised
shipping version or security endorsement. No all-Cargo-lock attribution was used.

The current installer workflow selects `windows-2022` or `macos-14`; runner labels
alone are not architecture evidence. The new producer observes the actual host
with Node and requires the corresponding input artifact name. The collected
macOS arm64 inputs do not establish a macOS x64 runtime.

## Read-only intake preflight

Use the existing `RuntimeInputs` schema documented in
[native-installer.md](native-installer.md#build-an-audited-runtime):

```sh
pnpm exec tsx scripts/native/inspect-runtime-inputs.ts runtime-inputs.local.json
```

This can run on a different OS. It checks exact file/license hashes, regular
unlinked files, nonempty notices, supported Node pins, CPU and OS headers,
native-tool rather than script inputs, support paths/owners and optional receipt
pins. It reuses the current hashing, path and architecture helpers. It emits no
local input paths and always reports `executed: false`,
`distributionApproved: false`, `status: pins-verified-only`. It does not parse a
license receipt as approval, load addons, execute a tool, or claim font validity.
Target staging and the existing attribution/linkage verifiers remain mandatory.
A successful synthetic unit fixture is only evidence about this checker.

## Manual target producer

`.github/workflows/native-runtime-stage.yml` is a new manual producer; it has not
been dispatched. It consumes reviewed intake bytes, runs the existing build and
staging tools, and uploads a runtime **for independent manifest review**. It has
no installer build, release upload, signing setup or native post-build dependency.

Before dispatch, independently review the actual binary/source/license/obligation
closure and target runtime linkage. Assemble an `inputs.tar` with regular files
only and `runtime-inputs.local.json` at its root. All local `source`,
`licenseFile`, dependency-license, linkage and attribution receipt paths must
resolve from the repository root under `reviewed-inputs/`; use the same prefix
inside nested obligation/text receipts. Preserve executable modes in the TAR.
Include no credentials, private media, unrelated host files or generic placeholder
receipts. Paths are not rewritten after review. Receipt content remains governed
by the existing stage/attribution/linkage checks.

Retain the independently reviewed SHA-256 of both `inputs.tar` and its exact JSON
bytes. The source Actions artifact must be named
`reviewed-runtime-inputs-<platform>-<architecture>` (for example,
`reviewed-runtime-inputs-win32-x64`) and belong to a successful, completed run in
this repository at the same commit as the producer dispatch. Retain that run ID,
artifact ID and source workflow numeric ID. The dispatch inputs bind all three
IDs and both hashes. The source artifact must already exist through a separately
authorized reviewed-input upload; this work creates no such run or approval.

The producer queries the authenticated repository Actions API and checks run,
workflow, repository ID/name, originating repository, commit, artifact name and
expiry before accepting transport. A cross-repository or fork-origin run fails.
The archive hash is checked before the existing bounded, link-rejecting extractor
runs; the JSON digest is checked before any candidate execution. Failed extraction
or JSON validation removes only the newly created intake directory. Frozen install
and build use this checkout. `stage.ts` then checks actual target identity and
creates runtime attribution/SPDX using the existing complete runtime review gate.
Test-only output cannot be uploaded by this producer.

Successful staging returns artifact `runtime-review-<platform>-<architecture>-<sha>`
containing `runtime.tar`, the generated `runtime-manifest.sha256` and the read-only
intake report. That locally generated digest is **not independently reviewed**.
After independent manifest review, use the existing installer workflow with the
producer's actual run/artifact IDs and accepted manifest digest. Its `verify.ts`
checks source/build identity and owned launch/close on the target. A failed smoke
or incomplete license/linkage receipt remains a block. Actual native shell,
generated/static/sysroot and final-shell linkage evidence follows the fixed
runtime build under issue 140; none belongs inside the immutable runtime manifest.

The [retained provenance and obligations matrix](validation/runtime-provenance-141.md)
records the 50 input hashes, static ABI/build observations and embedded signature
consistency checks. Those offline observations do not supply target FFmpeg inputs,
complete rights/source closure, OS trust or distribution approval.

## Evidence still required to close issue 141

- Independently reviewed target FFmpeg/FFprobe binaries, build options, matching
  source/offer/relink evidence and complete notices for all shipped contributions.
- Approved license receipts for Node, font, runtime JS, addons and emitted JS;
  actual target runtime linkage policies/observations with reviewed baselines.
- Real Windows/macOS staging run and artifact IDs, runtime SPDX and independently
  accepted manifest digest for each advertised OS/architecture.
- Actual owned launch/close and source/binary identity checks on those targets.

The new preflight, transport checks, source collection and producer remove local
preparation gaps. They do not close these external review or OS execution gates.
