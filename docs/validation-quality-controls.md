# Native text, photo movement and MP4 quality verification

Date: 2026-10-18. Integration base: main
`7011c48e9e26a681357de64d5cf47b94cbf5884d` (PR #22).
Source candidate: `6d2a1c7254a6712ce9722676dc3ef0e6e6e9f0e8`.
The subsequent documentation update changes no program or test source.

## Executed combined checks

- Format, i18n coverage (**1,383 semantic keys**), lint, TypeScript/Vue and build
  pass. The existing Vite large-chunk advisory is retained.
- **179 files / 2,707 unit/integration cases** pass with only
  `tests/unit/native-benchmark-runner.test.ts` excluded to avoid sharing its
  fixed service port with the concurrent browser run. This is explicitly not
  the full unit gate.
- **24 / 24 browser cases** pass in 3.2 minutes: six native-text / pull-out
  cases, fourteen existing photo-quality cases and four export-quality locales.
- Native controls were exercised at **1280×720, 1440×900 and 1920×1080** in
  en-US, zh-TW, ja-JP and en-XA. Export additionally checks width 1024.
- Sixteen screenshots were saved: twelve native-text screens and four export
  screens. The reviewer inspected actual English and Japanese screenshots for
  control visibility, readable labels, preserved export actions and overflow.
  Small monitor text is not evidence of projector or native display legibility.
- Independent code reviews of native text, pull-out and compression found no
  remaining P1/P2 correctness blocker at this source candidate.

## Correctness evidence

Native text uses measured local-font rasterization and clip-local fade timing;
generated decoded frames test scrim bounds, zero/long fades, nonzero clip starts,
source trim/speed and fractional frame rates. Existing project defaults remain
unchanged. The actual Fit preview regression failed with the old clip binding
and passes with candidate duration and a plain command plan.

Pull-out uses the existing shared motion endpoints (1.06 → 1) and easing. Its
command does not author a replacement layout, alter duration or touch music.
Tests cover protected sources, exact retry, Undo/Redo, persistence and generated
output endpoints.

Compression validation inspects actual x264 SEI and decoded audio in addition
to manifest evidence. Both profiles preserve real Full HD fractional-rate
fixtures, source hashes and composition data. A quality choice cannot restore
missing source detail or detail lost to existing photo-motion resampling.

## Final release gate

The integrating PR records the final exact head and complete serial results for
format, i18n, lint, typecheck, all unit/integration cases (including the benchmark
runner), build, browser, official OTIO, built CLI smoke and Linux native checks.
Published exact-head CI and review results must be green before merge; the
focused counts above do not substitute for them. Post-merge main CI is reported
separately. Check the PR and Actions for those changing states.

Private reference footage was unavailable in this cloud session. Windows/macOS
native behavior, real camera/HDR/4K sources, display/projector readability,
hardware/GPU performance and actual DaVinci Resolve import remain workstation
manual gates. No private-media quality or performance benchmark is claimed.
