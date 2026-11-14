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
tree. Inspection found that v0.5.0's `hdrToneMapFilter` also uses `zscale`, and
the existing `film-looks.test.ts` contains a real HDR tone-map regression. The
original macOS pinned `ffmpeg` lacked `zscale`; PR #129 exact-head run
[42386120211](https://github.com/bynanci/open-film/actions/runs/42386120211)
confirmed `No such filter: 'zscale'`.

The macOS QA pin therefore uses main's reviewed Homebrew `ffmpeg-full`
9.0.2_1 bottle and fixed formula, and requires both `zscale` and `tonemap`.
FFmpeg remains version 9.0.2; the change affects the CI test tool only. It
adds no application runtime dependency and leaves `pnpm-lock.yaml` unchanged.
Source and license scope are recorded in
`fixtures/render-qa/darwin-ffmpeg-full-review.json`. That file is a static
package review, not runtime installation evidence or distribution approval.

The v0.5 test harness reuses the existing pinned font inventory and
`render-qa-policy.ts` assertions. It adds no runtime or development dependency
and does not change `pnpm-lock.yaml`. The existing renderer uses `zscale`; the
macOS QA binary now supplies that required filter at the same FFmpeg version.

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
export OPENFILM_RENDER_QA_OUTPUT="$(mktemp -d)"
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
The first parser correction recognized bare values, `Parsed_perspective_N` and
`Eval` contexts, but the next run showed that FFmpeg could still emit a
platform-dependent number of `print()` evaluations.

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
reopen. At that point the full browser suite was still pending; exact-head
Verify 42390017052 later passed all six shards. Shard 5 took 9m48, including
`transcript-productivity.spec.ts` at 6m, so test partition/runtime optimization
remains a follow-up that must preserve assertions.

The following exact-head run
[42386120211](https://github.com/bynanci/open-film/actions/runs/42386120211) on
`83a27ca3162d223f4c1c8fcd952112673ab4b34b` exposed remaining gaps. Linux and
Windows each passed 56/57 tests but collected 256 and 258 easing log values;
macOS passed 54/57, with the same 258-value issue, missing `zscale`, and an
ambient fixture whose source pixel was not deterministic. The macOS job log
recorded a failed suite while its check run was green, so its result gate was
not trustworthy. The updated workflow delegates stage checking to a tested
TypeScript function.

The easing regression now limits input with `trim=end_frame=257`, disables
progress noise in FFmpeg's diagnostic log, and independently checks output
frame count through `-progress pipe:1`. It retains exactly 257 easing samples,
endpoints and the 5.1e-7 per-frame tolerance; it never synthesizes or drops a
sample. The ambient fixture explicitly converts to RGB and asserts its decoded
source pixel before measuring fill output. The macOS QA pin now requires both
HDR filters, as described above.

Verify [42386120251](https://github.com/bynanci/open-film/actions/runs/42386120251)
on that prior head passed fast-contract, all six browser shards, native-shell and
docs-site. Heavy media failed on the same easing assertion. Dependency Security,
Windows Recovery and DCO also passed on that head; these results do not validate
the fixes below.

## Local and hosted evidence; remaining gates

The selected existing v0.5 render regression files previously passed locally as
**7 files / 55 tests** on Debian 13 x64 with Node 24.19.0, pnpm 11.19.0 and system
FFmpeg/FFprobe 7.1.5. The complete candidate-specific selection passes
**8 files / 57 tests** with all four hash-verified candidate Noto font files and
OFL, including the bounded easing regression and decoded composite synthetic
evidence. Local FFmpeg/FFprobe remain system 7.1.5 rather than the pinned Ubuntu
6.1.1 package; this is diagnostic evidence, not hosted pinned admission. The
hosted exact-head matrix below exercises the pinned packages and Windows/macOS
runners.

On 2026-11-07, the complete local media suite passed **304 files / 3,658 tests**;
the contract suite passed **52 files / 1,183 tests**; and the focused easing,
ambient-fill and candidate-gate tests passed **3 files / 23 tests**. Format,
lint, typecheck, i18n checks, docs locale checks and `pnpm build` also passed.
The build emits the existing advisory that the main client chunk exceeds
500 kB; the build succeeds. The local candidate MP4 receipt records 160×90,
180 decoded frames at 30000/1001, nine PTS/RGB samples, mono AAC at 48 kHz,
288,768 decoded sample frames and matching before/after SHA-256 for all four
synthetic sources. This receipt was generated locally under `/tmp` and is not a
hosted or retained release artifact.

The corrected code head `2b5a6aa2e05e9ddd496c447ca60a753fadac8252` passed
exact-head Render QA [42390017057](https://github.com/bynanci/open-film/actions/runs/42390017057)
and Verify [42390017052](https://github.com/bynanci/open-film/actions/runs/42390017052).
Dependency Security [42390017076](https://github.com/bynanci/open-film/actions/runs/42390017076),
Windows Recovery [42390017113](https://github.com/bynanci/open-film/actions/runs/42390017113)
and contributor provenance [42390015259](https://github.com/bynanci/open-film/actions/runs/42390015259)
also passed on that SHA. The hosted receipts were downloaded and checked: each
platform reports 57/57 passed, no failures/skips, a 160×90 180-frame MP4 at
30000/1001, nine PTS/RGB samples, AAC audio and unchanged synthetic input
hashes. Linux used FFmpeg 6.1.1; Windows and macOS used 9.0.2. These links and
receipts are the evidence for `2b5a6aa`; any later PR head requires fresh checks.
This evidence-documentation update changes the PR head and therefore requires
another exact-head run before acceptance. Do not treat prior candidate runs or
main's D7A matrix as a substitute. No workstation verification, GLib approval,
merge, tag or publication is claimed.
