# v0.5.0 candidate Render QA

## Scope and status

This is the candidate-specific, synthetic-media Render QA gate for the staged
source-only v0.5.0 release. It runs the existing v0.5 renderer and its real
FFmpeg tests; it does not import the later main-branch renderer or change the
application dependency graph. The source-only candidate does not imply installer,
workstation, hardware, Resolve, audio-listening or release approval.

Candidate base: `release/v0.5.0` at
`d5a286ed9250872e8eb9b1c3e40adb926f913d34`. The candidate head must be read from
the current [Draft PR #129](https://github.com/bynanci/open-film/pull/129) and
must match every report and CI run used as evidence. Earlier reports for
`1f2e23d62ae61959167ad5c3994a0077efecd39f` predate this workflow and do not
validate the updated candidate.

## Why this is a separate candidate gate

Main's D7A workflow and evidence suite are not a compatible backport. Main
`73f9df9810770d52cab0cc2978e55ef8301f884e` adds a newer Render QA entry point,
metrics and renderer consumers that are absent from the historical release
tree. Main also changed the macOS FFmpeg pin to `ffmpeg-full` for its newer
`zscale` requirement. v0.5.0 instead preserves the pins already present in its
own `fixtures/render-qa/toolchain.json`, adding only the explicit Homebrew formula
name and revision needed to admit that existing bottle. Its filter admission
requires the v0.5-used `tonemap` filter and does not require main-only `zscale`.

The v0.5 test harness reuses the existing pinned font inventory and
`render-qa-policy.ts` assertions. It adds no runtime or development dependencies;
`pnpm-lock.yaml` is unchanged.

## Hosted matrix and commands

The workflow runs for pull requests targeting `release/v0.5.0`, pushes to that
release branch and manual dispatch. It has no path-based exclusions. Each job
checks out the exact PR head SHA and verifies that checkout against
`OPENFILM_SOURCE_CANDIDATE`.

| Platform ID    | Runner         | Candidate FFmpeg source                                            |
| -------------- | -------------- | ------------------------------------------------------------------ |
| `linux-x64`    | `ubuntu-24.04` | SHA-pinned Ubuntu FFmpeg `.deb` in `toolchain.json`                |
| `win32-x64`    | `windows-2022` | SHA-pinned FFmpeg ZIP in `toolchain.json`                          |
| `darwin-arm64` | `macos-15`     | SHA-pinned Sequoia Homebrew bottle and formula in `toolchain.json` |

All jobs use Node `24.14.0`, pnpm `11.11.0`, Python `3.12`, frozen workspace
installation, the four pinned Noto CJK faces and their OFL. The tool-admission
step verifies byte hashes, versions, architecture, font/license hashes and the
required filter before tests run. Linux stages only the admitted FFmpeg tools in
a dedicated bin so system paths cannot shadow the selected Node runtime.

Hosted execution is:

```bash
pnpm install --frozen-lockfile
pnpm exec tsx scripts/ci/setup-render-qa.ts hosted-tools "$RUNNER_TEMP/openfilm-v050-tools"
pnpm test:render-qa:release --reporter=default --reporter=json \
  --outputFile.json="$RUNNER_TEMP/openfilm-v050-vitest.json"
pnpm exec tsx scripts/ci/release-render-qa-v050.ts write \
  "$RUNNER_TEMP/openfilm-v050-vitest.json" \
  "$RUNNER_TEMP/openfilm-v050-render-evidence/render.json" \
  "$RUNNER_TEMP/openfilm-v050-reports/<platform-id>.json"
pnpm exec tsx scripts/ci/release-render-qa-v050.ts check "$RUNNER_TEMP/openfilm-v050-reports"
```

The matrix test selection is deliberately versioned in
`tests/render-qa-v050/test-files.ts`. It includes candidate tests for actual
rendering, PhotoDepth, photo motion/ambient fills, bilingual titles, film looks,
and audio quality, plus a v0.5 composite MP4. The composite render is decoded to
verify 180 frames at 160×90 and 30000/1001 fps, nine named PTS/RGB samples,
48 kHz AAC output, synthetic input hashes, and source-byte preservation. It
retains no generated media.

## Evidence and acceptance

Each platform uploads one JSON receipt, retained for 90 days. It contains only:

- candidate SHA, workflow run ID/attempt, platform ID and runner image;
- Node, pnpm, Python, FFmpeg and FFprobe identities, binary/configuration hashes;
- toolchain and policy hashes, four font hashes and the OFL hash;
- exact test-file inventory and per-file passed/failed/skipped/todo counts;
- four synthetic input SHA-256 pairs captured before render and after decode,
  encoded MP4 hash, decoded frame/timestamp/color observations, decoded audio
  format/sample count; the aggregate recomputes input immutability from each
  before/after hash pair instead of trusting a boolean from the test process;
- `workstationVerified: false`.

The artifacts contain no MP4/WAV, absolute local path, raw log or private media.
The aggregate job requires exactly `linux-x64`, `win32-x64` and `darwin-arm64`
from one run and attempt, for one clean candidate SHA. It rejects stale/duplicate
or missing receipts, unexpected fields, a wrong toolchain/policy/font hash,
failed or skipped tests, changed inputs, missing decoded samples, frame/timing/
pixel/audio measurements outside the frozen policy, or any failed matrix job.
Encoded output hashes are recorded per host for diagnosis and are not compared
across operating systems.

Candidate acceptance requires all three Render QA jobs and `v0.5.0 Render QA
complete` to pass on the same PR head, alongside fresh exact-head Verify,
Dependency Security, Windows Recovery and DCO. Any head update invalidates the
previous candidate evidence. This gate is separate from the GLib
`RUSTSEC-2024-0429` disposition and from physical workstation checks.

## Local evidence and outstanding verification

The selected existing v0.5 render regression files previously passed locally as
**7 files / 55 tests** on Debian 13 x64 with Node 24.19.0, pnpm 11.19.0 and system
FFmpeg/FFprobe 7.1.5. The complete candidate-specific selection passed
**8 files / 56 tests** with all four candidate-pinned Noto font files and OFL.
It produced decoded synthetic evidence with 180 frames, nine timestamp/color
samples, AAC decode and unchanged source hashes. Local FFmpeg/FFprobe are still
system 7.1.5 rather than the pinned Ubuntu 6.1.1 package; this is diagnostic
evidence, not hosted pinned admission. The pinned Linux package and Windows/macOS
runners remain hosted-only gates.

The new exact-head workflow has not yet completed for this updated PR. Record
its actual run ID, job results and artifact identities here after CI terminates.
Do not treat the successful main D7A matrix or the candidate's earlier Verify run
as a substitute. No workstation verification, GLib approval, merge, tag or
publication is claimed.
