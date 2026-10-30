# D5B title finishing validation

Base: `e1255b1a8a83260149211d909cca8c1a50948c6b`. Design/plan commit:
`69446b82cc1e16b539812a6fd6734f86a90940b3`. Source checkpoints extend strict
core contracts, the existing measured raster, typed editing, render/Collect
evidence and the actual Story/Record Monitor. Final independent review,
exact-head hosted gates are reported by the integrating parent; a source
checkpoint is not a merge claim. Six browser cases pass locally.

## Focused evidence

| Checkpoint              | Result observed during implementation                                                                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core layout/contracts   | 4 files / 98 tests passed; bounds, unknown versions, CJK paragraph owner, independent metrics and exact absent/empty legacy layout identity                                                         |
| Local font/raster       | 2 files / 9 tests passed; real CJK outlines, actual run faces/hashes, fallback/missing-font evidence, cache identities, paint bounds and unchanged legacy PNG bytes                                 |
| Editing/recovery        | 6 files / 265 tests passed; atomic conflicts, all lock sources, existing pins, exact retries, Undo/Redo, reopening, split/replacement and independent caption semantics                             |
| Font receipts / Collect | 4 files / 52 tests passed; independent usage assignments, unchanged legacy encoding, secondary font binding in a later/unselected caption Composition and relocated reopen                          |
| Application / HTTP      | 3 files / 5 tests passed; actual PNGs and path-free inspection, project/revision/settings/close fences, deduplication, one active/eight queued raster admission, 429 and existing photo HTTP export |
| Desktop components      | 7 files / 94 tests passed; actual Vue controls, four-locale legacy recovery, late-owner/decode rejection, half-open caption frames, overlapping cue ordering and font status                        |
| Actual pinned-font MP4  | 2 generated cases passed at 30 and 30000/1001 fps, with attached and standalone titles; details below                                                                                               |

These checkpoint counts overlap; they are not a summed full-suite result. Final
focused commands and current source identity are recorded in the implementation
handoff. TypeScript/Vue, changed-file lint and three-locale semantic checks also
run locally; final exact-head evidence remains authoritative.

## Actual media and font proof

`packages/render/tests/bilingual-title-finishing.test.ts` generates a five-second
procedural color video and a 440 Hz synthetic tone. A three-second Composition
uses trimmed source seconds 1–5 at speed 2 and an offset start. Primary
`繁體標題` and secondary `Our story` use different sizes, tracking and actual
Regular/Bold faces. The raster includes a shadow, outline and per-line pills;
the whole title fades during its final half-second. A native cue carries
`繁體字幕\nOur caption` at exactly 900–1500 milliseconds.

The test renders both the authored film and an otherwise identical baseline,
then decodes exact frame indices in shuffled order: first, middle and last
active title/caption frames plus the adjacent inactive frames. Opaque glyph,
outline, shadow and pill witnesses from the exact shared PNG are compared with
delivered pixels. MP4 uses the existing **high-detail / CRF18** profile explicitly
and a maximum channel error of 8/255 on flat interior witnesses. The source
SHA-256 is unchanged and included in the receipt. Decoded mono 48 kHz PCM is
byte-identical to the baseline, demonstrating that these text edits preserve
the rendered audio graph. Both actual run font assignments appear in the title
and caption receipt. The local tools were Node 24.19.0, pnpm 11.19.0 and
FFmpeg 7.1.5-0+deb13u1; frozen installation changed no dependency declaration or
lockfile.

The real MP4 check exposed inherited SVG stroke widths being scaled down by the
glyph transform. Per-glyph conversion now preserves composition-pixel stroke
width independently of the language size. The failing stroke witness passes
after correction. Standard / CRF23 produced a measured 13/255 error at an early
two-pixel glyph witness; this record does not apply the high-detail 8/255 bound
to standard compression. The comparator consumes D7A's exact shared
`title.highDetailGlyphChannelError` policy from `3683b1c` without migrating or
relaxing any other renderer metric. Real decoded wrong-frame and unstyled-film
negative controls must fail through the same comparator for every sampled
run/effect. Existing standard native-text/caption regressions
remain separate evidence. Position and recipe parity do not imply lossless
H.264 color values.

SRT and WebVTT serialization assertions preserve both literal languages and
`00:00:00.900`–`00:00:01.500` exactly, using each format's timestamp separator.
No typography/effect markup is invented. Existing format-parser regressions
remain part of the focused handoff.

The D7A common fixture helper was cherry-picked with parent authorization from
`11595f33b8b11817d1e7ade642f0907cd15a3e1e` as local commit `20d1a16`.
`tests/helpers/title-test-fonts.ts` consumes that shared admission when
`OPENFILM_TEST_FONT_ROOT` is set. Its four immutable Noto OTFs plus complete OFL
notice are hash-checked before use; D5B adds no pin or downloader. Without the
explicit root, ordinary tests use the existing admitted platform fonts and
explicitly select a Bold sibling/face, so a global Regular override cannot
silently stand in for every run weight.

The explicit-root local run used
`OPENFILM_TEST_FONT_ROOT=/tmp/openfilm-d7a-render-qa/fonts`. The actual Sans
Regular SHA-256 is
`dce08bd4fd91aa8aa76ed8fea4b694c2dfb8550f67871e326843212ddbeb88b4`;
Sans Bold is
`3ee160e5015106e3ec1a394301df54fa9bbbf8a251519984aec5c0abc50840c0`.
All four fonts and the OFL inventory were admitted by the shared helper. Font
files are local test inputs, not committed media or newly redistributed assets.

## Browser and remaining gates

`tests/e2e/title-finishing.spec.ts` contains six actual application cases:
independent controls/history/reopen and exact displayed PNG/canvas decoding;
Record caption boundary/selection parity with the MP4 selector; English,
Traditional Chinese and Japanese IME/coarse/narrow layouts; and missing
secondary glyphs plus delayed old-project responses. Inventory discovery passed.
All six executed and passed in 22.3 seconds under the parent's exclusive
browser lease, with actual Chromium at `/usr/bin/chromium`. The Record test also
decodes a real screenshot to prove caption glyphs paint above an opaque
GraphicScene. Initial failures were two fixture setup mistakes: the graphic
witness was inserted in a General case, and a saved caption edit correctly
remounted Record at frame zero. Moving the witness to Record and explicitly
seeking after save retained all original assertions. Ports 4310/1420 were probed
closed and the lease was explicitly released. Exact-head hosted CI remains
separate.

No private media, remote font service, NLE application, physical display,
Windows/macOS workstation or 4K performance test was used. Real display quality,
installer font rights and native editable NLE finishing remain their existing
manual gates. The original project schema, SQLite schema and media are retained.

## Final focused checkpoint

The selected 34-file regression run exercised 687 tests. It initially passed
686; the single `hands off native cuts plus measured graphic/caption precomps
and an aligned full mix` case used system `python3`, which lacked OpenTimelineIO.
The complete 62-case handoff file was rerun with the provided
`PATH=/tmp/openfilm-otio-venv/bin:$PATH`; all 62 passed. Across the run and this
corrected-environment rerun, all 687 selected checks passed. No test was disabled
or assertion relaxed. The other 33 files passed,
including existing standard title/caption output and export crop/font fences.

TypeScript/Vue, changed-file lint, three-locale i18n (2,695 keys), synchronized
English references and whitespace checks pass locally. No full Vitest suite,
native benchmark, push or PR was run by this worker.

## Cancellation retry correction

The final review found that an immediate same-cue request could inherit the
last subscriber's cancellation while abandoned work was still draining. The
service now admits a fresh operation through the existing queue when the
shared controller is aborted. Abandoned work retains its active slot until it
settles, and its cleanup removes a shared entry only while it still owns that
entry. Temporary raster files remain unique to each operation.

Two controlled regressions failed against the reviewed source: active and
queued immediate retries both rejected. All six service tests pass after the
correction. They retain a live second subscriber after the first cancels,
cancel the last subscriber during actual raster work, check replacement
sharing after old cleanup, and cancel 32 queued requests before admitting a
fresh retry. One active/eight queued admission, the ninth queued request's 429,
actual PNG output and temporary-file cleanup are asserted. Temporarily removing
only the entry-identity cleanup guard makes both retry regressions fail again.
The reviewer's isolated real-application cancel/immediate-retry probe now gives
`AbortError` for the cancelled request and a PNG for the fresh request.

The final fix run passes 12 tests across five files: service, title and existing
photo HTTP routes on port 0, NativeCaptionPreview, and both actual pinned-font
bilingual MP4 cases. The MP4 cases retain their existing font receipts,
styled-output checks, exact caption text/timing, source SHA, baseline PCM and
decoded negative controls. No existing assertion, legacy test, font input or
shared renderer metric changed. The supplied OTIO Python environment remains
on PATH.
TypeScript/Vue, changed-file lint, document mirrors and whitespace checks pass.
The integrating parent owns the fresh scoped review and full exact-head gate;
this fix wave ran no shared browser service, native benchmark or full suite.

## D3 → D5A → D5B integration checkpoint

Reviewed D5B `cde2b8a` now consumes clean A stack `add3ba6` through merge
`33ced46`. Additive API, application-service and Inspector conflicts preserve
both owners, PhotoLayout/Motion v2 and the captured-revision transaction barrier.
Caption rasters remain above opaque GraphicScenes and outside source grading.
The shared font helper is byte-identical to `11595f33`, and the shared metric
policy is byte-identical to `3683b1c`; no duplicate font policy was introduced.

The first six-case title browser run exposed a combined layout regression:
the waveform row reduced Record picture height to 96 pixels, and the unchanged
caption glyph check counted 34 bright pixels against its required >100. A new
picture-height regression failed at 96 versus 192 pixels. Raising only the
existing Record-with-waveform minimum from 6rem to 12rem preserves its existing
vertical scrolling and aspect-fit ownership. Final measured bounds are
341.328125 × 192 pixels. The unchanged glyph check passes above the opaque
GraphicScene. The cost on short screens is additional existing vertical scroll.

Current checks passed: 28 focused files / 439 tests; both actual bilingual
MP4 cases at 30 and 30000/1001 fps; three handoff/export/Record files / 157 tests;
all six title journeys plus all six Record Monitor browser cases in one 12-case
run; and both narrow CJK waveform journeys. TypeScript/Vue, scoped lint/format,
2,753 localization keys and 129 documentation mirrors passed. Actual synthetic
media, source hashes, picture screenshot and current byte receipts are retained
under `/tmp/openfilm-finishing-integration/B-current/`. Historical evidence is
retained separately. Full exact-head hosted gates and fresh integrated review
remain coordinator-owned.
