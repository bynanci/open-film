# Visual QA validation

This record validates M1/F07 from the saved Composition through the shared
application service. Fixtures must be generated or CC0; this file and test logs
must never contain private media, local source paths, or personal information.

## Scope

Automated Visual QA means a real FFmpeg MP4 render, FFprobe metadata, decoded
sample-frame timestamps and hashes, source-hash integrity, structured issue
classification, project-local cache isolation, cancellation/stale handling, and
Desktop/API/CLI navigation behavior. A generated fixture does not certify a
private film's artistic quality. Intentional black, quiet fades, composition,
readability on a real display, 4K throughput and actual Resolve/NLE behavior
remain human or workstation gates.

The machine can measure missing local assets, local title-font/glyph failures,
the existing renderer's measured title bounds, and unusually dark/uniform
decoded samples. Dark/blank samples are advisory `manual-review` findings and
never errors: software cannot know whether black is intentional. Other aesthetic
questions are explicitly left for a person.

## Execution record

Base: `089eaf20541391d59c81da075d739bcd3844ceb4` (`origin/main`).
Candidate branch: `codex/m1-f07-visual-qa`. Exact HEAD is included in the
delivery summary; this file avoids a self-referential SHA because it is part of
the committed tree. Validation ran on 2026-10-19 with Node
`v24.19.0`, pnpm `11.19.0` (the repository declares pnpm `11.11.0`), FFmpeg and
FFprobe `7.1.5-0+deb13u1`, Chromium `151.0.7922.173`, and OpenTimelineIO `0.18.1`.

The generated-media evidence test produced an actual H.264 MP4 at 160×90 and
8 fps. FFprobe decoded 8 frames, matching the report's frame count. Its selected
frame was index 4 at `0.500` seconds; FFmpeg decoded the extracted PNG and its
fresh SHA-256 matched the report. For this fully synthetic fixture, source SHA-256
was `b74c87b5c384c461b4cf395f901f3474ccab36ca66b77de30fa14723517253d9` and
MP4 SHA-256 was
`13abb9236a16b8438086648d6c4b6bc42e5f1756fabd5b66ce8f3d4deccaf1cf`. The
application regression also re-hashes the source after QA and compares every
sample's timestamp, image hash and decode result. Temporary evidence files were
removed after inspection.

The requested automated gates completed successfully:

| Command                                                                              | Result                                                                                                                                  |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`                                                                  | Pass                                                                                                                                    |
| `pnpm test:i18n`                                                                     | Pass; 1,414 semantic keys are aligned                                                                                                   |
| `pnpm lint`                                                                          | Pass with zero warnings                                                                                                                 |
| `pnpm typecheck`                                                                     | Pass                                                                                                                                    |
| `pnpm test`                                                                          | Pass; 182 test files and 2,752 tests                                                                                                    |
| `pnpm build`                                                                         | Pass; Vite reports its existing large-chunk advisory (753.86 kB, 231.68 kB gzip)                                                        |
| `pnpm test:e2e`                                                                      | Pass; 160/160 browser tests in 15.6 minutes, Chromium 151                                                                               |
| `OPENFILM_OTIO_PYTHON=/tmp/openfilm-visualqa-otio/bin/python3 pnpm test:interchange` | Pass; OpenTimelineIO 0.18.1, four real source fixtures, round-trip hash/bounds and relocation checks; real Resolve import is unverified |
| `pnpm test:native`                                                                   | Not run: native prerequisites are absent (`cargo`, `rustc`, GTK 3, WebKitGTK 4.1 and libsoup 3)                                         |

The new application regression exercises actual FFmpeg render/probe/frame
decode, legal-black manual-review classification, missing assets, font load and
glyph failures, measured title overflow, stale revisions, cancellation cleanup,
fresh retry identity and read-only polling. HTTP and CLI use the same
application service; integration tests cover report/frame serving, path
traversal rejection, project-switch blocking, cancel/retry and source-path
omission. The Desktop browser test confirms a generated contact sheet, decoded
samples, keyboard issue navigation to the matching Edit clip and invalidation
after a saved edit. i18n checks cover English, Traditional Chinese and Japanese.

No correctness blocker was found in the local automated gates. The build's
large-chunk notice is advisory and no native build was possible in this
environment. Hardware, 4K performance, private-film aesthetic judgment and
actual Resolve/NLE finishing remain manual gates below; they are not represented
as completed.

## Manual gates

- Review a representative private film locally without copying its media or
  report into the repository, logs, issue tracker or CI artifacts.
- Confirm perceived title readability, intended black/fades, transitions,
  motion and color on the target monitor/projector.
- Measure performance and memory on representative long films, 4K material and
  supported hardware.
- Import and finish representative output in the intended Resolve/NLE version.

These gates are not implied by synthetic fixture success.
