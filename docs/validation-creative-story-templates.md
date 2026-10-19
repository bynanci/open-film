# Creative Story Templates validation

This record tracks M4 / F02 on the M3-integrated base. It distinguishes local
results from the final PR head and from manual workstation evidence.

## Base and scope

- Repository: `bynanci/open-film`
- Base commit: `ab072e660d5913397efe1b98394611d2350bf895`
- Base contains M1 / F07, M2 / F04 and M3 / F01.
- M4 adds versioned optional `Composition.graphicSceneTemplates` records and a
  Desktop Gallery/Inspector over existing GraphicScene v1 nodes.
- No project schema version change, second timeline, source-media overwrite,
  remote GPX fetch, project-authored code or upstream renderer code/assets.

## Synthetic output evidence

`packages/application/tests/graphic-scenes.test.ts` creates a 24-second
synthetic H.264 source, two generated still images, a Traditional Chinese Conversation Card, a
manual Route Story with a fictional waypoint and a two-photo comparison. It
exports an actual MP4 through `OpenFilmApplication.exportMp4`, then:

- Uses FFprobe to assert H.264, 320×180, 12 fps, 288 decoded frames and 24-second
  duration.
- Decodes frames from each template section in shuffled timestamp order and
  repeats one timestamp to verify deterministic output.
- Checks the conversation card region, sequential route-dot pixels and separate
  left/right photo colors at their expected timeline positions.
- Compares render-manifest photo source SHA-256 values with fresh file hashes,
  checks the exact template records embedded in the manifest and preserves
  renderer warnings without rewriting them.

## Test coverage

- Core: strict template metadata, excerpt matching, route provenance and
  coordinate bounds, image-source identity, protected-region bounds and legacy
  Composition compatibility.
- Story: localized conversation builder, GPX entity/DTD/malformed-route handling,
  exact byte hash, bounded waypoint/point output and focus/compare/bookend layout.
- Solver/application: atomic scene/record edits, source-lock immutability,
  stale/orphan binding rejection, history, autosave, retry, reopen and actual MP4.
- Browser: edit all three templates with synthetic CJK text, explicitly selected
  synthetic GPX, two project photos, Undo/Redo and reopen.
- i18n catalogs retain identical semantic keys and placeholder shapes in
  en-US, zh-TW and ja-JP.

## Local verification

| Gate                                                                                 | Result                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`                                                                  | Passed on the candidate after formatting.                                                                                                                                                                                                                                          |
| `pnpm test:i18n`                                                                     | Passed: 1,551 semantic keys match across en-US, zh-TW and ja-JP.                                                                                                                                                                                                                   |
| `pnpm lint`                                                                          | Passed with zero warnings.                                                                                                                                                                                                                                                         |
| `pnpm typecheck`                                                                     | Passed for shared TypeScript and Desktop Vue types.                                                                                                                                                                                                                                |
| `pnpm test`                                                                          | Passed: 193 files, 2,863 tests. Includes the 24-second real FFmpeg MP4 regression.                                                                                                                                                                                                 |
| `pnpm build`                                                                         | Passed. Vite reports the existing 852.70 kB main chunk exceeds its 500 kB advisory threshold.                                                                                                                                                                                      |
| `OPENFILM_CHROMIUM=/usr/bin/chromium pnpm test:e2e`                                  | 162 passed; one unrelated Proposal Film case failed because system `python3` lacked OpenTimelineIO. The failed case passed separately with `OPENFILM_OTIO_PYTHON=/tmp/openfilm-visualqa-otio/bin/python3` (OpenTimelineIO 0.18.1); the M4 browser case passed within the full run. |
| `OPENFILM_OTIO_PYTHON=/tmp/openfilm-visualqa-otio/bin/python3 pnpm test:interchange` | Passed: official OpenTimelineIO 0.18.1 read/write/read, four real synthetic sources, source hash/bounds and relocation checks. Real Resolve import remains unverified.                                                                                                             |
| `pnpm test:native`                                                                   | Not run: Rust `cargo` is not installed in this environment.                                                                                                                                                                                                                        |

The CI result on the exact PR head is reported separately from these local
results. The local browser suite is not recorded as a single clean run: its one
environment-dependent failure was independently rerun with the documented
OpenTimelineIO interpreter.

Browser execution requires Playwright Chromium; this environment's system
Chromium is selected with `OPENFILM_CHROMIUM=/usr/bin/chromium`. Interchange and
the Proposal Film browser case require the dedicated OpenTimelineIO 0.18.1
interpreter through `OPENFILM_OTIO_PYTHON`.

## Manual gates

Not established by synthetic fixtures: private-film readability, physical
display/projection, large real GPX behavior beyond the bounded importer cases,
hardware performance, 4K output and Resolve/NLE finishing. These remain manual
release gates; no claim is made until they are performed and recorded.
