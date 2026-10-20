# M7D Collect Media validation

## Status

This is a candidate PR validation record. Automated local evidence is recorded
separately from CI and workstation verification. The package flow uses the
existing project schema/catalog and saved Composition; it does not change or
move original media.

## Synthetic relocation and render evidence

The application regression builds a synthetic project with ten generated still
images, one synthetic WAV narration, nested CJK source folders, same-name files
with different content, identical bytes at two paths, and an unused Library
asset. It saves a 3.05-second Composition at 10 fps so Verify also checks the
renderer’s complete-frame floor. Rights declarations cover the ten unique byte
sources and one resolved local font.

The test creates both ZIP and directory packages, checks the filtered project
and SQLite catalog, hashes all source/font bytes, moves the ZIP to a separate
root, removes the original media folder, then runs Package Verify. It reopens a
second relocated copy and exports another MP4. Every decoded frame hash matches
the pre-collection MP4; the sources remain unchanged. Package Verify checks the
renderer sidecar source hashes/output hash, decodes the output, and probes its
streams.

Expected synthetic output evidence:

| Measurement          | Result                                                              |
| -------------------- | ------------------------------------------------------------------- |
| Video                | H.264, 320 × 180, 10 fps                                            |
| Decoded video        | 30 frames, 3.0 seconds                                              |
| Audio                | AAC, 48 kHz, mono                                                   |
| Selected files       | 11 referenced assets: 10 images + 1 WAV                             |
| Deduplication        | 10 unique media byte sequences                                      |
| Unused Library asset | Excluded                                                            |
| Source hashes        | Match before package, after relocation, renderer receipt and reopen |
| Frame hashes         | All 30 baseline and relocated decoded frames match                  |
| Font receipt         | One hash-checked font; rights receipt required                      |

All media is generated for tests; no personal files are used.

## Automated coverage

The regressions cover:

- current-film scope, explicit rights, source/font hashes, duplicate content,
  duplicate names and catalog filtering;
- ZIP and directory creation, CJK paths, directory relocation and ZIP relocation;
- Zip Slip, drive-letter and UNC paths, symlinks, hardlinks, nested archive file
  extensions and archive signatures, malformed headers, duplicate/case-colliding
  paths, bad CRCs and cancellation cleanup;
- changed sources, stale project revisions, output overwrite, symlinked source
  and destination parents, active SQLite WAL snapshotting, missing-font and
  invalid-template-provenance blocking, private path redaction, and
  package-source URI rebasing;
- cancellation after staged source copies, cleanup with no published partial
  package, and a successful retry using the same current plan;
- HTTP plan/create/verify path fencing and Desktop rights → create → verify flow;
- reopened package rendering and actual FFmpeg/FFprobe source, frame and audio
  evidence.

### Local gates

| Command                 | Result                                                                                                                                                                                                                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`     | Passed; all matched files use Prettier style.                                                                                                                                                                                                                                                       |
| `pnpm test:i18n`        | Passed; 1,755 semantic keys matched across English, Traditional Chinese and Japanese.                                                                                                                                                                                                               |
| `pnpm lint`             | Passed with zero warnings/errors.                                                                                                                                                                                                                                                                   |
| `pnpm typecheck`        | Passed for TypeScript and Vue TypeScript.                                                                                                                                                                                                                                                           |
| `pnpm test`             | Passed: 213 files, 2,930 tests, 105.22 seconds.                                                                                                                                                                                                                                                     |
| `pnpm build`            | Passed; Vite reported the existing >500 kB bundle advisory.                                                                                                                                                                                                                                         |
| `pnpm test:interchange` | Passed with OpenTimelineIO 0.18.1 in a temporary Python venv; 18 parser tests and read/write/read passed. Resolve import remains unverified.                                                                                                                                                        |
| `pnpm test:e2e`         | Passed: 169/169 in 15.5 minutes with OpenTimelineIO 0.18.1 in the temporary Python venv and Chromium in `/tmp/openfilm-playwright-browsers`. The first run had 168 passes and one environment failure because the system Python could not import `opentimelineio`; the corrected full rerun passed. |
| `pnpm test:native`      | Not run: `cargo` and `rustc` are not installed in this environment.                                                                                                                                                                                                                                 |

Targeted M7D regressions passed separately: 6 Vitest files, 73 tests, including
real FFmpeg relocation/render, HTTP boundaries, catalog privacy, path-safety and
Desktop project-switch fencing. The focused Collect Media browser flow passed
before the full E2E suite started.

## Manual gates and limits

- Run relocation/reopen on real Windows and macOS filesystems, including path
  case behavior, file permissions, disk-full behavior and cancellation during
  an actual large-file copy.
- Verify CJK font appearance on representative Windows/macOS workstations and
  confirm each included font's license before distributing a package.
- Open a representative collected package in another machine and in a target
  NLE; this synthetic test is not a Resolve or workstation sign-off.
- Exercise projects with inaccessible fonts and malformed template provenance
  on a workstation; automated fixtures cover hash, stale-state and path failure
  handling, not subjective font or template quality.

The local verifier renders the first Composition for an entire-project package;
it retains the other saved Compositions without rendering each one during
verification. ZIP is stored-only and ZIP32-limited. The user-entered rights
receipt is not a legal determination. Candidate CI, independent review and the
cross-platform manual gates remain separate acceptance conditions.
