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
synthetic H.264 source, two generated still images, a four-message Traditional
Chinese Conversation Card with 36-character messages, a manual Route Story with
a fictional waypoint and a two-photo comparison. It exports an actual MP4
through `OpenFilmApplication.exportMp4`, then:

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

- Core: strict template metadata, excerpt matching and surrogate-pair boundary
  validation, route provenance and coordinate bounds, image-source identity,
  protected-region bounds and legacy Composition compatibility.
- Story: localized conversation builder and long-message fitting, GPX
  entity/DTD/malformed-route handling, exact byte hash, bounded waypoint/point
  output and focus/compare/bookend layout.
- Solver/application: atomic scene/record edits, source-lock immutability,
  stale/orphan binding rejection, history, autosave, retry, reopen and actual MP4.
- Browser: edit all three templates with synthetic CJK text and an emoji-safe
  excerpt range, explicitly selected synthetic GPX, two project photos,
  Undo/Redo and reopen.
- i18n catalogs retain identical semantic keys and placeholder shapes in
  en-US, zh-TW and ja-JP.

## Local verification

| Gate                                                                                                             | Result                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`                                                                                              | Passed on the candidate after formatting.                                                                                                                                                   |
| `pnpm test:i18n`                                                                                                 | Passed: 1,560 semantic keys match across en-US, zh-TW and ja-JP.                                                                                                                            |
| `pnpm lint`                                                                                                      | Passed with zero warnings.                                                                                                                                                                  |
| `pnpm typecheck`                                                                                                 | Passed for shared TypeScript and Desktop Vue types.                                                                                                                                         |
| `pnpm test`                                                                                                      | Passed: 194 files, 2,866 tests. Includes the 24-second real FFmpeg MP4 regression.                                                                                                          |
| `pnpm build`                                                                                                     | Passed. Vite reports the main 858.55 kB chunk exceeds its 500 kB advisory threshold.                                                                                                        |
| `OPENFILM_CHROMIUM=/usr/bin/chromium OPENFILM_OTIO_PYTHON=/tmp/openfilm-visualqa-otio/bin/python3 pnpm test:e2e` | Passed: all 163 browser tests, including source attribution/ranges, reordering, ID uniqueness and project reopen (16.0 minutes). Targeted M4 case also passed after grapheme-index changes. |
| `OPENFILM_OTIO_PYTHON=/tmp/openfilm-visualqa-otio/bin/python3 pnpm test:interchange`                             | Passed: 18 OpenTimelineIO 0.18.1 checks, four real synthetic sources, source hash/bounds and relocation checks. Real Resolve import remains unverified.                                     |
| `pnpm test:native`                                                                                               | Not run: Rust `cargo` is not installed in this environment.                                                                                                                                 |

The CI result on the exact PR head is reported separately from these local
results. The full browser run used the dedicated OpenTimelineIO interpreter so
the Proposal Film fixture could pass on this machine.

Browser execution requires Playwright Chromium; this environment's system
Chromium is selected with `OPENFILM_CHROMIUM=/usr/bin/chromium`. Interchange and
the Proposal Film browser case require the dedicated OpenTimelineIO 0.18.1
interpreter through `OPENFILM_OTIO_PYTHON`.

## Manual gates

Not established by synthetic fixtures: private-film readability, physical
display/projection, large real GPX behavior beyond the bounded importer cases,
hardware performance, 4K output and Resolve/NLE finishing. These remain manual
release gates; no claim is made until they are performed and recorded.
