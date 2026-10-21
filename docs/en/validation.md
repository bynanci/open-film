# Validation record — 2026-10-05

This is the historical first vertical-slice record. See
[Real Editing Workflow validation](validation-real-editing.md) for the subsequent
editing, portability, camera adapters and Resolve preparation gates.

The initial 0.1.0 implementation was verified on Linux x86_64 in the cloud
workspace using Node24.14.0, pnpm11.11.0, FFmpeg/FFprobe7.1.5, Perl5.40.1,
ExifTool13.59 and Rust1.99.0. These results cover the source tree; they are not
an installer release or a downstream NLE compatibility certification.

| Check                                                           | Result                                                                                                                                                                                                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`                                             | Passed                                                                                                                                                                                                                                |
| `pnpm verify`                                                   | Lint, strict TypeScript/Vue types,98 tests in14 files and CLI/server/Desktop production builds passed                                                                                                                                 |
| `node scripts/smoke-built-cli.mjs`                              | Built CLI created/reopened SQLite projects, imported real generated media, saved state, composed the nine-beat template, rendered bounded playable MP4 and exported timelines; original hashes unchanged. Failed import returns exit1 |
| `pnpm test:interchange`                                         | Official OpenTimelineIO0.18.1 read/write/read preserves source ranges, offsets, duration and tracks. Python XML parser verifies FCPXML resources, lanes and rational times                                                            |
| `pnpm test:e2e`                                                 | Three actual Chromium browser journeys passed: full film workflow/reopen; import cancellation; pending FFmpeg render cancellation.375px layout has no horizontal overflow                                                             |
| Native `cargo fmt`, `cargo clippy --all-targets -- -D warnings` | Passed                                                                                                                                                                                                                                |
| Native `cargo test` / `cargo build --locked`                    | Compile/link succeeded; native Rust test targets currently contain zero tests. Native window/folder-picker behavior was not exercised headlessly                                                                                      |

The browser run used `/usr/bin/chromium`151 via `OPENFILM_CHROMIUM`. This was
sufficient for these OpenFilm journeys; it is not proof for other projects' pinned
browser/offline tests. Native build dependencies were extracted from official,
GPG-authenticated Debian packages into a workspace sysroot; already installed
runtime libraries were linked locally. No system package database was changed.

Adversarial review and regressions cover hardlinks to originals in thumbnail and
proxy output, unsafe cache paths, rejected future database/schema versions,
failed story edits preserving memory/disk, concurrent edit/project-switch ordering,
active render cancellation, FFmpeg title paths containing apostrophes and other
punctuation, and native-origin CORS media loading. Generated fixture media is
procedural and public domain. No private media or paid provider was used.

CI is configured to repeat source, media, independent interchange, browser and
native build checks. A remote CI run is separate evidence. Archive-scale
benchmarks, NLE application imports, packaged installers, actual native window
interaction, relinking and AI provider implementations remain listed in TASKS.
