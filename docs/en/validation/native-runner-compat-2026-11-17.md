# Native runner compatibility — source readiness

Date: 2026-11-17. Initial implementation base:
`55ee98655cef3f5c5a0f8a4788953a13d14021ca`. Integration base after rebasing the
separate native follow-up:
`d56161b59e195f7e5fe84eada0d3311239ec51f6` (PR #168 merge). The native
implementation and tests were unchanged by that rebase. PR #168's CI results
belong to its own source head; they do not verify this native follow-up's head.
This bounded follow-up updates the manual native workflow source and local
guards. It supplies no hosted native staging run, installer build, package,
receipt, signing or workstation evidence.

## Compatibility decision

The official runner image
[README at `2cdd82f`](https://github.com/actions/runner-images/blob/2cdd82f39871ec1e98584ee64008bc1261ce427f/README.md)
identifies `macos-14` as x64 and says all GitHub macOS 14 images retired on
2026-11-02. Its supported macOS 15 labels distinguish `macos-15-intel` (x64)
from `macos-15` (ARM64). The Azure DevOps extension does not extend GitHub's
retired lane.

The existing native workflows selected `macos-14`; runtime staging requires
the actual host and reviewed runtime architecture to match, and Cargo target
resolution preserves that equality. The intake record also distinguishes its
collected macOS ARM64 inputs from the still-missing x64 runtime. Therefore both
native choices move to `macos-15-intel`, retaining `darwin/x64` and
`x86_64-apple-darwin`. This does not introduce an ARM64 native workflow target
or establish a deployment baseline for runtime inputs.

## Admission and local validation

Immediately after checkout, both workflows run the shared native `runner`
preflight. It allows only Windows x64 and Intel macOS x64 for runtime staging;
the installer retains its existing Linux x64 choice as well. It rejects unknown,
missing, retired and unsupported workflow/label selections, checks Node's
`process.platform`/`process.arch` and GitHub's `RUNNER_OS`/`RUNNER_ARCH`, and
requires all identities to match the selected lane. The label enters the shell
through a quoted environment variable. This check needs no reviewed runtime
manifest, installed dependencies or Cargo invocation.

The existing host/runtime equality, authenticated input transport, reviewed
manifest digest, complete rights/SBOM/linkage review, same-build Cargo capture,
security admission and exact-head checks retain their existing behavior.

Initial test-first verification:

- Baseline Cargo capture test file: 12/12 passed before edits.
- New runner CLI regression failed before implementation because it reached
  runtime-manifest lookup; the guard tests then passed with the implementation.
- Cargo capture test file: 38/38 passed, including all five existing dispatch
  lanes, rejected labels, host/context mismatches, strict CLI arguments, early
  execution without a runtime, Darwin x64 paths and cross-architecture refusal.

Fresh local verification after rebasing onto the integration base above:

- Seven focused native unit files passed 191/191 cases: Cargo capture, runtime
  intake, Cargo paths/attribution, candidate receipts, runtime attribution and
  runtime manifests. The extraction and input-preparation Python suites passed
  7/7 and 4/4 cases respectively. No full-suite pass is claimed.
- TypeScript `tsc --noEmit`, scoped ESLint/Prettier, documentation mirror checks
  and `git diff --check` passed.
- Official actionlint 1.7.12 passed both workflows with `-shellcheck=''` and no
  diagnostic suppressions; this checks workflow syntax/context, with shellcheck
  integration outside scope. The older 1.7.7 tool's `artifact-ids` metadata
  diagnostic was reproduced on both unchanged base workflows. The existing
  artifact selection and download behavior were preserved.

## Remaining gates

No native runtime producer or installer workflow was dispatched for this change.
Actual target execution and a candidate-specific native build remain unverified.
Issue #141 still requires reviewed target binaries, source/rights closure,
runtime SPDX, real staging IDs
and an independently accepted manifest digest. Issue #140 still requires the
real installer invocation and candidate-bound receipts. Signing/notarization,
OS trust/lifecycle and physical workstation gates remain open. Exact-head
source CI and independent review remain necessary before integration; local
runner admission does not satisfy those gates.
