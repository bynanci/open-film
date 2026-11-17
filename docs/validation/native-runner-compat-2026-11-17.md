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

## Ubuntu bootstrap follow-up

The prior native candidate
`d50f98687933a5478358c3a471dd38c2e85f4052` did not pass its complete source CI.
Its [Verify run 44090197737](https://github.com/bynanci/open-film/actions/runs/44090197737)
ended with [native-shell job 134063018526](https://github.com/bynanci/open-film/actions/runs/44090197737/job/134063018526)
cancelled. The check annotation states: "The job has exceeded the maximum
execution time of 30m0s". The retained raw job log has SHA-256
`f4c366a91a939b7afd1e47585bbf7e37b700ddb5c70a4917345c84fdfb1746d2`.

APT index acquisition started at 13:11:29 UTC, reported Azure mirror ignores
and official HTTPS archive progress, then stopped reporting progress at
13:11:47 until cancellation at 13:41:26. No completed index update, package
installation or Rust installation was observed; dependency installation,
builds and native tests downstream were skipped. This establishes an APT
acquisition stall and the job timeout. It does not establish a DNS failure or
the precise transport cause.

The source omission is confirmed: native prerequisites used raw APT commands
instead of the bounded mirror/transport policy already used by media CI.
`scripts/ci/ubuntu-apt.sh` now shares that existing policy across media,
native-shell, native source admission, the manual Linux installer and Linux
Render QA tool setup. It keeps the exact Azure-to-official-HTTPS substitution,
`Acquire::Retries=2`, HTTP/HTTPS timeouts of 30 seconds and a 60-second dpkg
lock timeout. Suites, components and signing keys remain unchanged. All
privileged operations use `sudo -n`; only update/install modes and the existing
install flags/package/archive operands are admitted. No GPG bypass, alternative
package version or ignored failure is introduced. Production uses the fixed
`/etc/apt/apt-mirrors.txt`; only the sourced preparation function accepts a
fixture path for offline controls.

The native-shell, source-admission and manual-installer prerequisite steps now
have eight-minute limits. Their existing 30/60/45-minute job limits remain
unchanged, as do all test timeouts and assertions. Acquisition timeouts alone
are not total runtime limits. Media package/PIP selections and the Render QA
download hash, deb version/architecture and installed-version admission remain
intact. Windows/macOS tools and native target choices are unchanged.

Follow-up local validation:

- The new Bash regression first failed on the actual old native-shell block:
  `Missing existing bounded APT transport policy` (status 97).
- Mandatory Ubuntu fast-lane Bash controls passed 18/18 cases, exercising the
  actual native-shell, native-security and manual installer blocks, exact media
  package/PIP arguments, temporary mirror fixtures, quoted archives, argument
  rejection and preparation/update/install failure propagation. The real mirror
  file remained unchanged. The controls use fake sudo/APT/Rust/PIP boundaries,
  with no real privileged, package-management or network execution.
- Ten focused native/CI Vitest files passed 292/292 cases, including the original
  seven native files' 191 cases and three existing CI files' 101 cases. Native
  extraction/input preparation passed 7/7 and 4/4 Python cases; existing source,
  media-profile and DCO Node controls passed 16/16; Python media-profile process
  controls passed 4/4.
- TypeScript, scoped ESLint/Prettier, documentation mirror checks, Bash syntax
  and diff checks passed. Official actionlint 1.7.12 passed the four affected
  native/Verify workflows with `-shellcheck=''` and no diagnostic suppressions.

The follow-up requires a new complete exact-head hosted source run, including
actual Ubuntu prerequisite setup. The prior candidate's other passing checks
and these offline controls do not establish that result. This follow-up adds
source-readiness controls and supplies no native installer or workstation proof.

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
