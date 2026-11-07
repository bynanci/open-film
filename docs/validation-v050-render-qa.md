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

The first valid hosted matrix on `0e38878f3f7fe555e7b769fb197a86f2891c0aa6`
([run 42381329547](https://github.com/bynanci/open-film/actions/runs/42381329547))
passed Linux and macOS. Windows decoded the same MP4 and passed its 55 other
selected checks, but the easing test parsed only `stderr`; that run established
the need to read both streams. The next exact-head matrix on
`c4f302b6e0db9c513d71979050a4f8b197c46e23`
([run 42382091334](https://github.com/bynanci/open-film/actions/runs/42382091334))
again passed Linux/macOS and decoded Windows MP4 evidence, but its pinned Windows
FFmpeg produced no lines matching the numeric-only parser in either captured
stream. The report records 55/56 Windows checks passed; this was a test-output
format failure, not evidence that the render differed.

Run [42383763652](https://github.com/bynanci/open-film/actions/runs/42383763652)
on exact head `93982583e1481b54f71c9e1d8b4f0d24560a8cd0` passed macOS. Linux
parsed 256/257 actual FFmpeg `print()` values because FFmpeg compressed the
repeated endpoint message; Windows parsed 0/257 because its FFmpeg used the
`[Eval @ …]` prefix. The 257-sample, endpoint and tolerance assertions correctly
failed on both hosts. However, all three hosts decoded the composite MP4 to 180
frames and passed the nine PTS/RGB, AAC, source-hash and other report checks.
The parser now recognizes bare values, `Parsed_perspective_N` and `Eval`
contexts, and the regression uses `-loglevel repeat+info` so duplicate samples
are preserved in the log. It does not infer or synthesize missing samples.

The same exact-head Verify run
[42383763684](https://github.com/bynanci/open-film/actions/runs/42383763684)
passed fast-contract, native-shell, docs-site and all six browser shards. Heavy
media had 3,656/3,657 tests pass; its only failure was the same 256/257
photo-easing log assertion. The c4 browser failure was reproduced with a
deterministically held font-size acknowledgement: the safe-area input reset from
18 to 12 before it could be submitted. Candidate `TimelineEditor.vue` now keeps
the safe-area form draft local until its value changes, matching the established
main-branch behavior. The targeted end-to-end test went red before this fix and
passed after it; it still checks persisted cue/track values, Undo, Redo, save and
reopen. This branch has not yet completed the full browser suite after that
change.

## Local evidence and outstanding verification

The selected existing v0.5 render regression files previously passed locally as
**7 files / 55 tests** on Debian 13 x64 with Node 24.19.0, pnpm 11.19.0 and system
FFmpeg/FFprobe 7.1.5. The complete candidate-specific selection now passes
**8 files / 57 tests** with all four candidate-pinned Noto font files and OFL,
including the updated repeated-sample regression and decoded composite synthetic
evidence. Local FFmpeg/FFprobe remain system 7.1.5 rather than the pinned Ubuntu
6.1.1 package; this is diagnostic evidence, not hosted pinned admission. The
pinned Linux package and Windows/macOS runners remain hosted-only gates.

A new exact-head Render QA and Verify run must be recorded after these changes.
Do not treat prior candidate runs or main's D7A matrix as a substitute. No
workstation verification, GLib approval, merge, tag or publication is claimed.
