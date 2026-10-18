# MP4 compression quality validation

Date: 2026-10-18. Base main:
`7eb9aaa0407a521c635a24b7b08a2e2d173e8523`.
Development branch: `codex/export-quality`. This record concerns the bounded
compression/readout slice; published exact-head and combined regression results
belong to the integrating PR.

## Observed failures before implementation

- Renderer tests observed missing profile metadata, high-detail remaining at
  CRF 23 / veryfast, and unsupported values being accepted.
- Four initial application/HTTP/CLI cases failed: malformed options created render jobs,
  HTTP ignored the requested profile, interchange accepted a video-only option
  and CLI rejected the missing `--quality` flag.
- Two App request tests failed because rendered preview / MP4 export omitted
  the selected quality. Nine component cases failed before the controls existed.

## Focused executed evidence

- Twelve actual FFmpeg renderer cases pass. They inspect x264 SEI (`crf=23.0`,
  `subme=2` versus `crf=18.0`, `subme=7`), not only self-reported metadata.
- Standard / omitted quality produce the same decoded video and audio fixtures;
  Standard / High detail retain identical decoded audio, source hashes, trims,
  locks, looks and composition data in the generated scenario.
- Real Full HD renders retain 1920 × 1080, 30000/1001 and twelve frames in both
  profiles. The fixture supplies twelve exact frame intervals (0.4004 seconds);
  the existing frame-alignment policy was not changed to satisfy the test.
- Eight malformed renderer values leave an existing output/manifest pair intact.
- Five application/HTTP/CLI cases pass, including Unicode/space/#/& paths,
  validation before HTTP job reservation and immutable quality capture when
  the caller changes its options during asynchronous preparation. No fixed
  browser ports are used.
- Nine component tests pass: actual saved frame/fractional fps, accessibility,
  busy/unknown-value guards, transient events, preserved action placement and
  four locale catalogs. Together with existing i18n tests, 20 cases pass.
- Fractional fps uses locale-aware number formatting with at most three decimal
  places: 30000/1001 displays as 29.97 without changing the saved rate.
- App request regressions verify captured quality for preview/MP4 and exclusion
  from editable exports. Existing cancellation behavior remains in the same gate.
- The full renderer package plus existing film-look application/adapters passed
  93 cases across fourteen files. A fresh UI/i18n/App/new-adapter group passed
  51 cases across four files. These overlapping groups are not a total-suite count.
- Build passed with the existing Vite large-chunk advisory; no performance
  threshold or chunk-warning limit was loosened.
- Repository format check, i18n coverage, lint and TypeScript/Vue type checking
  pass in this isolated worktree. No dependency or schema migration is needed.

## Integration gate pending

The four-locale browser spec covers 1024, 1280, 1440 and 1920 widths, original
action visibility, overflow, accessibility and saved-data isolation. It has been
added for the integrating PR and has not yet been run in this isolated worktree.
Full format/i18n/lint/typecheck/unit/build/browser/interchange/native and remote
CI results must be recorded for that combined candidate. Focused success does
not substitute for those gates.

No speed, size or subjective-image benchmark is claimed. Native Windows/macOS,
actual camera/HDR, intended-display/projection and real Resolve gates remain open.
