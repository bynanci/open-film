# GraphicScene validation record

Initial fork: `4d79c78b8e33f74efe322132561cd46e55a942fc`.
Integrated main/base: `514a6f098f0893df503d34d16f88cff1adec2787` (M1 PR #27
and M2 PR #26 merged). Branch: `codex/m3-f01-graphic-scene`.
[Contract](graphic-scenes.md) and [threat model](security/graphic-scene-threat-model.md)
define the scope. Exact final head, CI runs and merge result belong to the PR.
The latest user instruction authorizes review and merge after the gates pass.

## Baseline and execution

Before implementation, `pnpm test` passed 183 files / 2,768 tests. Schema/evaluator,
solver/application commands, actual MP4 pixels, preview service, portable references,
schema boundary cases, review races and M1 QA adapter gaps were observed failing
before their respective fixes. The branch then integrated M1 main, preserving its
caption checks, source/cancel fences and animated-photo navigation. The only merge
conflict was the appended CSS; both feature sections were retained.

The first integrated whole-tree gate passed format, i18n, lint, TypeScript/Vue,
191 unit/integration files / 2,847 tests, build and OTIO 0.18.1 interchange. An
additional review regression for a supported ordinary BMP used as an unsupported
graphic image increased the expected final count to 2,848. It was observed failing
with a generic renderer error; QA and rendering now share byte/codec admission.
The corrected whole-tree gate passes all 191 files / 2,848 tests, format,
i18n (1,500 semantic keys), lint, TypeScript/Vue, build and OTIO interchange.
The full browser and native/published-head results are recorded in the PR before
merge. The build retains its existing large-chunk advisory.

Focused checks include 37 core schema/evaluator cases, six solver cases (including
same-length and longer regeneration), seven application history/preview cases,
four actual-render/security cases, exporter metadata and HTTP isolation cases,
and 21 Visual QA cases. The browser authors all four primitives, edits CJK text,
checks real PNG pixels, seeks in `[3,0,5,3]` order, disables/re-enables animation,
then verifies Undo/Redo, autosave and reopen. These focused checks pass.

An early browser assertion assumed that rapid group/child edits created separate
Undo entries; the existing autosave intentionally batches them. The test now waits
for the accepted group save before adding the child, then verifies independent
Undo/Redo without changing history behavior or weakening assertions.

## Actual FFmpeg evidence

The renderer fixture generates a green PNG and a silent synthetic animated MP4.
No private images, transcripts, proposals or personal data enter its output.

| Check                          | Actual result                                                                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H.264/AAC MP4                  | 6.000000 seconds, 320×180, 30 fps; FFprobe decodes 180 frames                                                                                                                         |
| Decoded frames                 | 0 / 90 / 179; yellow rectangle at expected first/mid/last positions, fixed green image, visible Traditional Chinese glyphs and correctly composited blue/red group opacity            |
| Arbitrary producer seek        | `[90,0,179,17,90,0,45,179]`; repeated PNG bytes match and different animation times differ                                                                                            |
| MP4 seek                       | Decode middle, then first, then middle; repeated decoded bytes match                                                                                                                  |
| Provenance                     | Original image hash unchanged; scene-only asset and local font hashes appear in manifest; legacy source changes cannot silently mismatch manifest even with equal size/restored mtime |
| Local reference source SHA-256 | `e8066f84f20e1daa77aa21b18b18a9e42cb59d029712cdee21c9e44020e27453`                                                                                                                    |
| Local reference output SHA-256 | `ab4ee2c0dc2ae126ff2fa6eafa015650857e578a2d243d506f9a6f845c04b588`                                                                                                                    |

Hashes are per generated run/toolchain; CI records its own exact values rather
than asserting binary equality across FFmpeg/font versions. Reproduce and retain
only this synthetic fixture:

```sh
OPENFILM_GRAPHIC_QA_OUTPUT=/tmp/openfilm-graphic-scene-qa \
  pnpm exec vitest run packages/render/tests/graphic-scenes.test.ts
ffprobe -v error -count_frames -select_streams v:0 \
  -show_entries stream=width,height,avg_frame_rate,nb_read_frames,duration \
  -of json /tmp/openfilm-graphic-scene-qa/animation.mp4
```

CI's media job publishes `synthetic-graphic-scene-<checked-out-sha>` with the MP4,
synthetic source, manifest, first/mid/last Monitor PNGs and decoded MP4 PNGs, plus
`evidence.json`. That directory is populated exclusively inside this fixture;
opened user projects never feed the artifact. Existing Apache-2.0 and NOTICE
remain unchanged.

## Review corrections and safety

- Final cleanup/revision awaits originally allowed an external source write to
  return an old preview. A deterministic scheduling regression failed before the
  fix; receipts now check inode/size/nanosecond mtime/ctime for all sources after
  cleanup and the final revision check. The original repro now rejects the PNG.
  This bounds asynchronous windows; it is not an atomic filesystem snapshot.
- Disabling the last animation left an invalid empty animation object. The browser
  regression failed before correction and passes after removing that empty object.
- Graphic-only images and text originally bypassed M1 source/font/overflow checks.
  Three failing adapter cases now pass with scene/node IDs and correct local boxes.
- Generic still preview supports BMP, while GraphicScene supports PNG/JPEG/WebP.
  A further failing case now yields typed `asset.unsupported` for the graphic
  occurrence while the same BMP continues working as an ordinary clip.
- Byte reads, private snapshots, forced codecs, actual dimensions, tree/texture/
  output/work limits, abort/retry, concurrent work, stale/project mismatches and
  cache-symlink refusal have automated coverage. Disguised SVG/HTML cannot publish
  output, execute project markup or modify the original.

## Manual gates and limits

Playback is a sampled preview; paused frames use the exact requested output grid.
No real-time, GPU, hardware/4K throughput, color-managed display, target-projector
readability or actual Resolve/NLE finishing claim follows from these fixtures.
Local Rust/Cargo/GTK/WebKit prerequisites are unavailable; native validation must
pass in published-head CI, which installs the required native toolchain.

Aesthetic clipping/placement and intended black scenes require manual review.
JSON preserves scenes and image identities; OTIO retains metadata with explicit
manual-recreation warnings. FCPXML/EDL reject unsupported scenes. Broader clip
keyframes remain deferred; M4 photo narrative/consented assistance is next.
