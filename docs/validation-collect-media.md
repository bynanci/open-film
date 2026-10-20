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

## PR37 review remediation — 2026-10-20

The original M7D gates above are historical. The review remediation starts from
`cd537da784d73478a8d156fcc9677aafd8f79e26` and adds 21 focused regression cases.
All 21 cases fail against the reviewed baseline and pass with the candidate,
including missing font bindings and missing font files on direct reopen.
All persisted Story and Composition asset references are checked against the
packaged catalog, and every saved text style requires a package font binding.
The render check still uses the first Composition.

The regressions cover valid names containing `secret`, `password`, `credential`
and `api-key`, retained `360-video` Story candidates, every non-owned rights
basis without a license name, nested GraphicScene text, and recollection of two
relocated copies. Raw 360° clips still require a reframed export for rendering.
Real FFmpeg output is deliberately changed to the wrong dimensions or stripped
of its embedded video soundtrack, with its output hash receipt updated; Verify
rejects both outputs during decoded stream inspection.

Both directory scans now observe cancellation while hashing. A deterministic
test aborts on the first chunk of a generated BMP larger than 4 MiB. The
reviewed baseline read the entire original 4 MiB fixture after cancellation;
the candidate reads less than 512 KiB in each scan
and leaves the original package intact. This is a bounded-read correctness
check, not a throughput benchmark.

Current local validation uses Node 24.19.0, pnpm 11.11.0 and FFmpeg/FFprobe 7.1.5,
with Vitest limited to one worker:

| Check                                                                                                  | Result                                         |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| Collect review, collect relocation/render, archive and HTTP suites                                     | Passed: 4 files, 29 tests.                     |
| Reopen/relink, managed-source relocation, project versions, catalog and Desktop navigation regressions | Passed: 5 files, 71 tests.                     |
| `pnpm typecheck`                                                                                       | Passed: TypeScript and Vue TypeScript.         |
| `pnpm format:check`                                                                                    | Passed.                                        |
| `pnpm lint`                                                                                            | Passed with zero warnings/errors.              |
| `pnpm build`                                                                                           | Passed; existing Vite >500 kB bundle advisory. |

The existing synthetic relocation test still verifies identical decoded frames
after removing the original sources, exact source/font hashes, ZIP and directory
packages, catalog filtering and source-path privacy. CI, browser, native and
workstation gates have not been rerun as part of these local remediation checks.

A separate retained synthetic handoff contains a one-second H.264 film at
160 × 90 and 10 fps, AAC audio at 48 kHz, and one hash-checked packaged font.
All ten decoded frames match the baseline after source removal and relocation;
ZIP, directory and recollected-directory verification pass, and recollection
retains the original source URI digest.

## Referenced-source security follow-up — 2026-10-20

A synthetic hostile project reproduced a source-file boundary gap in
`0caff4d1444dec734eb3874970f1cb8a6fc043e5`: a fake `.aws/credentials` file
declared as `photo.png`/`image` and referenced only by a Story was copied into a
package that Verify accepted while rendering an ordinary flat video. Only
generated fake credential bytes were used; no real credential files were read.

Known credential locations are now rejected before opening source bytes.
Every media source must also pass the existing file-only protocol and demuxer
allowlist, with safe FFprobe metadata inspection, one decoded frame from the
required stream, and a type check based on the actual container and streams.
Inspection is bound to an unchanged file identity
and hash. Creation repeats this validation before copying and checks the staged
copy; Verify inspects every asset, including Story-only candidates, before
rendering. Valid credential-like display names remain supported.

The focused security cases cover credential paths without byte reads,
plaintext, truncated images, playlists disguised as media, false catalog media
types, source replacement, symlink changes after planning, and a forged package
whose manifest/catalog/hash receipts consistently describe non-media bytes.
Supported single-frame videos and audio with attached cover art remain
packageable. Existing fencing, cancellation and HTTP fixtures now use genuine
generated media; the HTTP regression also verifies its resulting package.

The source-safety suite has 15 passing cases: 12 failures reproduced against
the reviewed candidate, one pre-existing symlink fence, and two media
compatibility checks. Focused collect/archive/HTTP/input-policy coverage totals
51 passing tests in six files. TypeScript, Vue TypeScript, lint and formatting
checks pass. These checks use one Vitest worker and isolated ephemeral HTTP
ports; the full suite and browser tests are not part of this follow-up.

## Additional PR37 review findings — 2026-10-20

Five additional findings were confirmed against the credential fix
`053fc337a5e7a92af9e715f3fda6438fb1ca2757`. Nine new regression cases fail
against that baseline and pass with the fixes:

- Rights resource IDs use identifier validation, so legitimate IDs containing
  `secret`, `password` or `credential` can receive the required declaration.
- Embedded POSIX, Windows and file-URI paths in asset tags receive the existing
  metadata path redaction before the portable catalog is written.
- Generated font family and PostScript identities retain safe text shape checks
  without receipt-prose keyword filtering. A real locally renamed font verifies
  and reopens with `Secret` in its family and PostScript names.
- Directory verification inventories aggregate file sizes and rejects packages
  above the ZIP32 limit before opening payload bytes. A bounded synthetic
  metadata fixture exercises the limit without allocating gigabytes.
- Stored ZIP extraction rejects prefix bytes, gaps between local records and
  gaps before the central directory. Adjusted offsets and valid file CRCs do
  not permit unreceipted payloads outside the file records.

The combined focused run passes 60 tests across the six collect, archive, HTTP
and input-policy files. TypeScript, Vue TypeScript, lint and formatting checks
pass. The earlier manual and cross-platform gates remain separate.

## Delayed-stream compatibility follow-up — 2026-10-20

Independent review found a valid six-second MP4 whose audio starts at zero and
whose ten video frames start at five seconds. The first 32 global packets
contain no decoded video frame, so the original bounded packet check rejected
the otherwise valid Story candidate. The new regression fails against
`abfdf106bbab7dc4939e0f978d985075eca7ee4a` before the fix.

Metadata inspection now selects the actual required stream index. FFmpeg maps
only that stream and decodes one video or audio frame into a frame-hash receipt;
an empty decode is rejected. Both child processes retain the input demuxer and
file-protocol allowlists, a 30-second timeout, bounded output and cancellation.
Hash and file-identity checks still bind inspection to the copied bytes.

The delayed candidate now plans, collects and verifies successfully. The 22
source-safety cases preserve valid cover-art audio and single-frame video while
rejecting forged non-media payloads. Combined focused validation passes 61
tests in six files; typecheck, lint and formatting pass.

## Empty ZIP entry follow-up — 2026-10-20

Review finding `4327721357` was reproduced from
`ed76f1a17d9a00adbadf67f148ec00e0683ca4d7`: the stored ZIP writer emitted
valid zero-byte entries, but extraction constructed a read range whose end was
before its start. Empty entries now feed an empty stream through the existing
exclusive file creation and CRC pipeline. Central-directory bounds, descriptors,
inventory, private file modes and cancellation checks remain active.
The writer also checks cancellation before opening its output and after syncing,
passes the signal to its output stream, and waits for close before removing only
an output it created. This preserves prior files after an exclusive-create
collision and prevents cancellation from leaving a late output, including an
empty archive with no entry pipeline.

Seven focused cases cover an empty file's SHA-256, mixed empty/nonempty UTF-8
entries, tampered size and local-header bounds, a forged empty CRC, existing
target preservation and cancelled extraction. Three writer cases cover existing
archive preservation and cancellation while real opens are deliberately held
pending for empty and nonempty roots. Four empty-entry cases and two writer
controls have causal failing runs; all eighteen archive cases pass afterward.
Independent delayed-open and real-sync cancellation probes also reject without
leaving an output after the operation returns. Synthetic
round-trip artifacts and local verification logs are retained under
`/tmp/openfilm-v1-validation/pr41-empty-zip-*`.

Final focused verification passes 64 tests in five collect, archive, source
safety and HTTP files with one Vitest worker. TypeScript/Vue checks, changed-file
lint, formatting and diff checks pass. This follow-up runs no full or browser
suite; combined release gates remain with the coordinator.

## Atomic no-overwrite directory publication — 2026-10-20

Finding `4328164569` was reproduced on integrated commit
`a48f3e911fe10db7045dfd45fb4a2d42a3012e66`: a separate real process could
create an empty destination after the final existence check, and POSIX directory
rename replaced its inode. Audio-stem directory publication had the same defect.

Both paths now publish their complete private stage with an OS atomic no-replace
rename through the pinned Koffi wrapper. Linux uses `renameat2` with
`RENAME_NOREPLACE`, macOS uses `renamex_np` with `RENAME_EXCL`, and Windows uses
`MoveFileExW` without replacement. There is no ordinary-rename fallback. The
native loader finishes before the final source, revision and cancellation fence;
the fence and native rename run synchronously. A stage inode receipt is captured
before loading and checked before and after publication. Existing directories,
files and symlinks remain untouched, and no incomplete directory is exposed.
ZIP publication keeps its existing exclusive hardlink boundary.

An unavailable native operation or unsupported filesystem produces a typed,
localized choice to use a ZIP package or another disk. It does not attempt a
weaker publication mode. Native library integrity, licensing, bundler externals
and staged runtime delivery are validated separately with the wrapper changes.

After a late cancellation or stale revision, rollback moves only the known owned
directory back to its private stage through the same exclusive primitive. It
never recursively removes the public destination. A foreign replacement or a
raced private rollback path is preserved and reports recovery failure. Collect
retains its safe aggregate recovery metadata; stem export retains original PCM,
renderer receipts and its aggregate manifest in private work. A complete package
that cannot be reclaimed is kept for explicit recovery rather than deleted.

A portable directory-copy prototype was rejected after real independent tests
found an initial ownership-adoption window and a killed-process retry regression.
Its RED evidence is retained under `pr41-directory-copy-draft-retained` and the
independent stem evidence; the shipped path preserves whole-directory atomic
visibility and durable retries. The bounded regressions use synthetic media and
real child processes, including competing inode owners, actual PCM export,
SIGKILL/reopen with the same request ID, source hashes, final abort/revision fences
and recovery ownership. Cross-platform native calls and filesystem behavior still
require the manual gates below.

Final local verification passes 148 tests in eight focused publication, Collect
and export files, plus 12 core/error-localization tests. TypeScript/Vue checks,
changed-file lint, formatting, diff checks and all 1,973 semantic localization
keys pass. The frozen offline install applies Koffi's disabled lifecycle policy.
Independent Collect and stem reviewers separately bind their actual-process
checks to the final source commit; full release gates remain with the coordinator.

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
