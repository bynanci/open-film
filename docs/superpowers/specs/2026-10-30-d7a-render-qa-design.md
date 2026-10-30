# D7A reproducible render QA design

Status: proposed design for independent review; no implementation or OS result is
claimed. Base: `e1255b1a8a83260149211d909cca8c1a50948c6b`. This implements the
existing D7A/F13 owner in `TASKS.md`, not a new roadmap queue or a version promise.
Stable application metadata remains 0.4.0 and project schema remains 1.0.0.

## Intent and scope

Make a small set of actual render observations repeatable on explicit Linux,
Windows and macOS runners. Preserve the units, comparators and values of existing
assertions. Prove that deliberately broken output fails the same measurements
that accept the valid control. Use licensed, fixed font bytes and reviewed tool
provenance, with no dependency on an assumed system font directory.

D7A owns test helpers, a text tool record, ephemeral tool/font staging, focused
synthetic fixtures and automated evidence. D7B owns native dependency remediation,
installer runtime/sidecars, distribution notices, signing and workstation gates.
This change does not implement photo/title/color authoring contracts, change
render algorithms, widen any threshold or certify aesthetics/listening/hardware.

## Approaches and proposed choice

1. **Share existing pins and add a focused suite (recommended).** Extract the
   current Windows FFmpeg9/Noto staging inputs into one checked text manifest and
   one setup implementation. Add platform-specific trusted tool admissions and
   one common font directory. Run a small suite beside the unchanged full Verify
   and Windows recovery journeys. This has explicit ownership and avoids forcing
   all development tests to download fonts or use a different FFmpeg.
2. **Run every media/browser test on three OSes.** Broader coverage, but existing
   Linux font paths, OS permissions, NLE tooling and browser setup need unrelated
   work. It does not identify which measurement catches a deliberate defect.
3. **Compare encoded MP4 hashes between OSes.** Cheap to state but unsuitable:
   codec builds, metadata and linked libraries can change encoded bytes while
   preserving output. Encoded SHA-256 is evidence identity, never the cross-OS
   acceptance criterion.

The first choice is the author's proposal, pending parent review. No approval of
product implementation is inferred from committing this design and plan.

## Observed supply-chain facts, 2026-10-30

- Local execution host: Debian 13 x64, Node 24.19.0, pnpm 11.19.0, FFmpeg and
  FFprobe 7.1.5-0+deb13u1, GPL-enabled and shared. Rust/Cargo are absent. These
  observations are not the proposed hosted tool pins or a completed render run.
- Existing `.github/workflows/windows-media-recovery.yml:42-69` already pins
  Gyan FFmpeg 9.0.2, four Noto faces and the OFL. These are the authoritative
  Windows values to extract, without a second downloader or a second pin list.
- The `Sans2.004` Noto tag resolves to commit
  `523d033d6cb47f4a80c58a35753646f5c3608a78`. The full LICENSE at that immutable
  commit hashes to `6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2`.
- GitHub's runner catalog identifies `macos-15` as ARM64 and `macos-15-intel` as
  x64. `macos-14` is deprecated and scheduled to be unsupported on November 2, 2026. Use `macos-15` with an ARM64 admission check, not the old M7E label.
  The published macOS 15 ARM64 image lists Homebrew but does not list FFmpeg;
  installation and actual linked-library observations must occur in the job.
- Homebrew core commit `e1b76dede00f5b34ee6488722499c7de7964daf1` declares FFmpeg
  9.0.2 revision 1, GPL-3.0-or-later. Its formula file SHA-256 is
  `1f3e7264a319af3096a9487b6847cf8dc1f888c7798a66b5f91bde1459a7a421`.
  The ARM64 Sequoia bottle SHA-256 is
  `65ba8ccb4778a0554346f416cd9a64c6cce2f92c7af5effb48deb6b757f01678`.
  It has shared Homebrew dependencies; a verified bottle is not a self-contained
  native runtime. Do not assume a Homebrew prefix or an installed version.
- Ubuntu Noble's official amd64 universe index currently supplies
  `ffmpeg` version `7:6.1.1-3ubuntu5`, file
  `pool/universe/f/ffmpeg/ffmpeg_6.1.1-3ubuntu5_amd64.deb`, SHA-256
  `1a23baace5f2688a47e28119aedae6993cd638e6279a7227dfc52d9a337a1c17`.
  This package contains both executables and uses separately installed libav
  packages. Verify the archive before installation and record actual linked
  package versions; do not call the entire Linux library closure content-pinned.
- Direct FFmpeg release/checksum URLs returned HTTP 503 during this audit. No
  source-build fallback or independent upstream signature verification was run.

Primary sources: [runner catalog](https://github.com/actions/runner-images),
[macOS retirement](https://github.com/actions/runner-images/issues/13518),
[fixed Homebrew formula](https://github.com/Homebrew/homebrew-core/blob/e1b76dede00f5b34ee6488722499c7de7964daf1/Formula/f/ffmpeg.rb),
[Ubuntu package index](https://archive.ubuntu.com/ubuntu/dists/noble/universe/binary-amd64/Packages.gz),
[fixed Noto source](https://github.com/notofonts/noto-cjk/tree/523d033d6cb47f4a80c58a35753646f5c3608a78).

## Tool and font admission

Create `fixtures/render-qa/toolchain.json` with schemaVersion 1. Store HTTPS origin,
immutable source/release identity, exact version/revision/architecture, archive
SHA-256, license provenance and the four font/one OFL hashes. Its Windows archive
is the existing Gyan 9.0.2 essentials ZIP, SHA-256
`60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba`.

`scripts/ci/setup-render-qa.ts` is the only new acquisition entry point. It stages
fonts for all OSes, handles the existing Windows archive recipe, and verifies
Ubuntu/Homebrew packages supplied by the trusted platform installer. It never
accepts a project URL, executable, manifest or hash from the application/UI.
Unknown host/architecture, changed upstream metadata, bad hashes, missing tools,
unsupported license state or failed installation fail the job. No latest-version
fallback, local hash self-approval or automatic pin refresh is permitted.

For macOS, check the trusted Homebrew formula/API describes exactly 9.0.2_1 and
the expected ARM64 Sequoia bottle before fetching/installing; hash the fetched
bottle before use. Derive paths using `brew --prefix ffmpeg`, then verify both
programs' version lines and actual executable hashes. Repeat metadata/version
checks after installation. If the installed Homebrew tooling cannot fetch/admit
the specified bottle, stop with an actionable failure; do not silently build from
current HEAD or install another version. Record `brew info --json=v2` dependency
identities and `otool -L` results locally; publish a path-free summary only.
The exact Homebrew admission/install command sequence is an implementation spike
on an actual ARM64 hosted runner, not a result claimed by this document.

For Linux, use the fixed official `.deb`, verify its digest and package version,
then install its dependencies with APT's authenticated repository mechanism. Do
not use `--allow-unauthenticated`. Record the runtime libav package versions and
actual executable hashes. A missing fixed archive or unsatisfied dependency is a
failed admission. This focused test tool pin is not an installer security review.

For Windows, move the existing ZIP extraction/hash/version logic into this shared
setup implementation. Preserve its failure behavior, PATH export and four-font
installation required by existing recovery tests. Keep Git Perl setup and all
existing recovery assertions/journeys intact. The workflow calls the helper; it
must not retain a separate inline download/pin list.

Downloads use bounded sizes/timeouts and allowlisted HTTPS origins/redirects;
verify bytes before extraction or installation. Archives reject traversal,
unexpected links and ambiguous executable matches. Setup writes only beneath its
explicit temporary root, apart from the existing Windows test-font installation
and trusted package-manager operations in ephemeral hosted jobs. No binary,
font, package archive or media file is committed or uploaded as an artifact.

### Shared test-font interface and D5B seam

`OPENFILM_TEST_FONT_ROOT` is an explicit absolute directory, independent of the
renderer resolver and OS font locations. It contains these exact names:

| Key          | Filename                   | Family/weight           | SHA-256                                                          |
| ------------ | -------------------------- | ----------------------- | ---------------------------------------------------------------- |
| sansRegular  | NotoSansCJKtc-Regular.otf  | Noto Sans CJK TC / 400  | dce08bd4fd91aa8aa76ed8fea4b694c2dfb8550f67871e326843212ddbeb88b4 |
| sansBold     | NotoSansCJKtc-Bold.otf     | Noto Sans CJK TC / 700  | 3ee160e5015106e3ec1a394301df54fa9bbbf8a251519984aec5c0abc50840c0 |
| serifRegular | NotoSerifCJKtc-Regular.otf | Noto Serif CJK TC / 400 | 360778af67c4591d03997312ee33d7354727637faf8a7f57f705a380c7b81fa3 |
| serifBold    | NotoSerifCJKtc-Bold.otf    | Noto Serif CJK TC / 700 | 6fc7c0854585330a09c0ae48638a48aa5b8f4bd3f30f63cdb0a3927206b14874 |

It also contains `Noto-SIL-OFL.txt` with the LICENSE hash above. Resolve font URLs
from the fixed commit and the existing `Sans/OTF/TraditionalChinese` or
`Serif/OTF/TraditionalChinese` paths. All five files are regular, bounded files;
reject symlinks, unexpected root aliases, missing roots and changed bytes.

`tests/helpers/render-qa-fonts.ts` exports:

```ts
type PinnedTestFontKey =
  "sansRegular" | "sansBold" | "serifRegular" | "serifBold";
type PinnedTestFont = Readonly<{
  path: string;
  sha256: string;
  family: string;
  weight: 400 | 700;
}>;
function readPinnedTestFonts(
  root?: string,
): Promise<Readonly<Record<PinnedTestFontKey, PinnedTestFont>>>;
```

An omitted argument reads `OPENFILM_TEST_FONT_ROOT`; absence fails. The helper
hashes bytes before returning identities and never infers validity from a family
name. D5B accepted this seam: its `fontPathForStyle` injection can map the requested
family/weight to these paths. D7A owns pins/acquisition; D5B owns title semantics.
The current base also supports explicit `createTitleOverlay(..., {fontPath})`.
Set `OPENFILM_TITLE_FONT` to the verified sansRegular path for existing default
render paths; test the other three faces through explicit font-path calls.

## Metric policy v1

Create a pure `tests/helpers/render-qa-policy.ts`. Export an immutable
`renderQaPolicy` and `assertRenderQaMetric(id, actual, expected?, context?)`, returning a
path-free measurement record and throwing on a failed or invalid measurement.
Only `closeTo` and `exact` rules consume `expected`; all other rows consume the
specified observable directly (absolute-error rows receive an absolute error).
Require finite numbers; the bounded decode/measurement helpers validate
dimensions/sample counts and nonzero divisors before calculating observables.
Missing, NaN or infinite data cannot become a pass. Preserve strict bounds.
`context` is `{frameRate?: number}`; the photoFilm.durationError rule requires a
finite positive frameRate and records its effective `1/frameRate+0.001` limit.
No caller-supplied threshold or comparator override is accepted.

| Metric ID                     | Observable/unit                                             | Exact acceptance                           | Existing owner                        |
| ----------------------------- | ----------------------------------------------------------- | ------------------------------------------ | ------------------------------------- |
| photoDepth.rgbMae             | mean absolute RGB channel error, 0..255 units               | <12                                        | photo-depth.test.ts:971               |
| photoDepth.edgeChannelError   | absolute channel error, 0..255 units                        | <=8                                        | photo-depth.test.ts:304               |
| photoDepth.alphaChannelError  | absolute channel error, 0..255 units                        | <=8                                        | photo-depth.test.ts:466               |
| filmLook.channelError         | absolute channel error, 0..255 units                        | <=3                                        | film-looks.test.ts:138                |
| cutDesk.channelError          | absolute channel error, 0..255 units                        | <=12                                       | professional-cut-desk.test.ts:82      |
| cutDesk.pts                   | frame presentation time, seconds                            | existing toBeCloseTo(expected,6) semantics | professional-cut-desk.test.ts:100     |
| cutDesk.primaryAmplitudeError | Fourier peak amplitude error, linear f32 full scale         | <0.006                                     | professional-cut-desk.test.ts:192,280 |
| cutDesk.overlayAmplitudeError | Fourier peak amplitude error, linear f32 full scale         | <0.004                                     | professional-cut-desk.test.ts:195,270 |
| cutDesk.absentAmplitude       | Fourier peak amplitude, linear f32 full scale               | <0.003                                     | professional-cut-desk.test.ts:199,285 |
| cutDesk.onsetGainRatio        | measured/expected positive peak, ratio                      | >0.9                                       | professional-cut-desk.test.ts:281     |
| title.textDelta               | first visible text minus source luminance, 0..255 units     | >60                                        | native-title-controls.test.ts:209     |
| title.scrimDelta              | first visible scrim minus source luminance, 0..255 units    | <-60                                       | native-title-controls.test.ts:210     |
| title.opacityRatio            | later delta / first delta, ratio                            | existing toBeCloseTo(expected,1) semantics | native-title-controls.test.ts:221,224 |
| title.sourceLuminance         | source luminance, 0..255 units                              | existing toBeCloseTo(expected,0) semantics | native-title-controls.test.ts:225     |
| title.exclusiveGateLuminance  | decoded luminance before start/at exclusive end             | <5                                         | native-title-controls.test.ts:228,231 |
| audio.integratedLufs          | integrated loudness, LUFS                                   | >-35 and <-10                              | audio-quality.test.ts:37,38           |
| audio.trueMinusSamplePeak     | true peak dBTP minus sample peak dBFS, dB                   | >=-0.2                                     | audio-quality.test.ts:39              |
| audio.duration                | seconds                                                     | existing toBeCloseTo(expected,1) semantics | audio-quality.test.ts:44              |
| photo.subjectEdgeError        | source-feature position error, output pixels                | <=1.5                                      | photo-quality.test.ts:179,516         |
| photo.firstFrameCenterError   | luminance-weighted center displacement, pixels              | <0.12                                      | photo-quality.test.ts:360             |
| photo.panTravel               | last minus first weighted center, pixels                    | >1.5                                       | photo-quality.test.ts:418             |
| photo.panStep                 | maximum adjacent weighted-center displacement, pixels/frame | <0.18                                      | photo-quality.test.ts:422             |
| photo.fadeOutRmsRatio         | endpoint/baseline decoded RMS, ratio                        | <0.2                                       | photo-quality.test.ts:595             |
| photo.fadeInRmsRatio          | start/baseline decoded RMS, ratio                           | <0.5                                       | photo-quality.test.ts:596             |
| photo.duration                | seconds                                                     | existing toBeCloseTo(expected,1) semantics | photo-quality.test.ts:608             |
| photoFilm.durationError       | absolute duration error, seconds                            | <=1/frameRate+0.001                        | scripts/photo-film-quality.ts:236     |
| identity.frameCount           | decoded video frames, integer                               | exact expected count                       | existing render/export fixtures       |
| identity.sourceHash           | lowercase SHA-256 of source bytes                           | exact expected hash                        | existing render manifests             |
| identity.fontHash             | lowercase SHA-256 of resolved font bytes                    | exact pinned face hash                     | existing font receipts                |
| identity.decodedLossless      | decoded bytes of compared lossless frames                   | exact within the same run                  | existing PNG preview/still fixtures   |

Keep the photo-quality duration assertion with precision 3 at line220 as a
separate `photo.tightDuration` rule (`closeTo`, digits 3); do not merge it into
the precision-1 duration rule. Other fixture-specific geometry/color assertions
remain in their existing tests, with unchanged values. This is a bounded policy
inventory, not a claim that every assertion in the repository has been migrated.
Characterize `closeTo` boundaries against pinned Vitest 5.0.3 before extraction;
the helper must retain its strict precision behavior instead of rounding data.

Source/font/decoded-byte identities use dedicated exact-identity helpers rather
than numeric coercion. Encoded output SHA-256 is always recorded and never passed
to a cross-OS equality rule. Sample positions and expected values remain hand
derived in fixtures; production evaluators must not compute both actual and
expected sides of a check.

## Focused actual-media suite and deliberate controls

Create `tests/render-qa/render-qa.spec.ts` with its own Vitest config. This new
focused suite is outside the root include patterns and owns explicit font/tool
prerequisites; existing full tests keep their existing prerequisites and coverage.
Root unit tests exercise the pure policy and setup contract. Do not move existing
tests out of the root/full media lane or introduce skip/continue-on-error paths.

Use a bounded 160x90 or 320x180 six-second synthetic H.264/AAC MP4 at 30000/1001,
generated source color changes and 440/660/880/1100 Hz pulses. Reuse the existing
professional cut desk fixture/hand-derived expected PTS and gain windows rather
than inventing a second editing timeline. Decode RGB24 and mono f32le at 48 kHz;
retain the existing 50 ms integer-cycle windows and onset/steady-state distinction.
Add a small explicit-font Traditional Chinese/Latin overlay for each pinned face
and the existing PhotoDepth representative frame comparison. No private source,
default OS font or requested remote asset participates.

For each valid result, run a corresponding deliberate failure through the same
assertion path: a one-frame pulse/PTS shift; primary/overlay gain or absent-tone
contamination; RGB perturbation exceeding its declared bound; a font file/hash
substitution; a changed source receipt; wrong/missing decoded frame count; and
changed lossless decoded bytes. At least the timing/audio and pixel controls
operate on genuinely re-encoded/decodeable output, not only edited JSON reports.
Font/source hash controls use ephemeral copies; never alter installed fixtures or
original source files. Unit boundary tests additionally prove strict < versus <=,
precision behavior and rejection of empty/NaN/infinite measurements.

## Evidence and CI contract

Add `.github/workflows/render-qa.yml` with explicit `ubuntu-24.04` x64,
`windows-2022` x64 and `macos-15` ARM64 entries, fail-fast false, no PR path bypass,
Node24.14.0, pnpm11.11.0 and frozen installation. Use one worker for the focused
suite; no server or fixed port is required. Each job verifies actual OS/arch,
candidate SHA and pin admission before execution. Existing Verify, native-shell,
browser discovery/count/result gates and Windows recovery test selection remain.
Machine platform IDs are exactly `linux-x64`, `win32-x64` and `darwin-arm64`.
On PRs, checkout and report `github.event.pull_request.head.sha`; otherwise use
`github.sha`. Verify the actual checkout HEAD equals that selected candidate.

`RenderQaEvidence` v1 records candidate SHA, current run ID/attempt, OS/arch/image,
Node/pnpm, tool version/configuration/executable hashes and admitted package hash,
font/OFL hashes, policy version and hash, source/output SHA-256, decoded format,
sample indices/times, metric IDs/units/comparators/limits/measurements and named
valid/negative outcomes. `workstationVerified` is always false. Missing results or
unexecuted controls cannot be labeled successful. Preserve failure evidence.

Upload only bounded, path-free JSON/text/log receipts for seven days. MP4/PNG/WAV,
font/tool/package files and private FFprobe paths remain ephemeral and are removed.
An always-evaluated `render-qa-complete` job accepts exactly one successful report
per declared platform bound to the current candidate/run/attempt, with every
required metric/control present and successful and all prerequisite jobs successful.
Missing, duplicate, skipped, failed, cancelled or mismatched reports fail closed.

Actual hosted execution will resolve Homebrew admission/tool capabilities and
whether unchanged limits hold on these exact OS builds. A failure requires
diagnosis or a new reviewed compatibility decision, not a threshold adjustment.
CI outcomes remain automated evidence. Physical Windows10/popopc/macOS, NLE/Resolve,
4K/GPU, private-film aesthetics, listening and native installer gates remain open.
