# M7A / Named Versions validation

## Scope and status

This candidate is based on the freshly fetched `main` SHA
`ba7af5067c486654a9708c6f0df00c923ab9cfb6`. It adds project-owned immutable
manifest/catalog snapshots and structured comparison/restore without changing
project schema 1.0.0 or catalog schema v5. The versions store is optional, so
existing projects without `versions/` remain readable. This record distinguishes
implemented behavior from CI and workstation sign-off; it does not authorize a
merge.

## Regression coverage

- Core validates versioned records and produces deterministic path-free diffs.
- Catalog captures a consistent SQLite image across WAL transactions and
  restores rows with schema/integrity checks. Writer contention and publication
  failure preserve the prior catalog/manifest.
- Application covers durable create/list/inspect/diff/rename/restore, lost
  response idempotency, reopen, immutable package content, source fingerprint
  checks, stale revision refusal, current locks, explicit confirmation,
  interrupted restore recovery, and symlink rejection. Regressions also prove
  that name-only renames keep descriptions, any field change on a locked asset
  blocks restore, locked clips cannot move between tracks, manifest edits both
  before and during publication remain on disk, and staged catalog rows roll
  back when the latter race is detected. Managed source URIs rebase after a
  project directory moves; symlinked `sources/` roots and nested parents fail
  closed before a managed source is hashed.
- HTTP/CLI tests share application behavior and reject unknown request fields;
  API output omits source paths. Playwright covers create, compare, rename and
  explicit restore from the localized Versions workspace.
- The actual renderer regression executes V1 → edits → V2 → close/reopen/diff →
  restore V1 → MP4 → close/reopen/restore V2 using generated video+tone and two
  generated stills. It decodes before/during/after caption times and the photo
  comparison, verifies shape placement, H.264 dimensions/fps/frame count,
  AAC presence, duration and bounded decoded audio RMS, and checks every source
  hash against both the render manifest and original synthetic bytes.

## Local actual FFmpeg evidence

FFmpeg/FFprobe: `7.1.5`. One local regression output was H.264, 320×180 at
12 fps, 48 video frames, four seconds, with AAC audio. Decoded video samples at
0.1 s, 1.0 s and 2.5 s verified subtitle absence/presence and two-photo
placement. Measured decoded audio RMS was `0.0230981242` with the saved 0.25
automation gain. The render reported no warnings. Output SHA-256:
`75c829f6faf22e19f1da53be2f389dd2724d19e9e5198476930748fb94a7b306`.

The synthetic background/tone and red/blue photo hashes were checked from the
fresh source bytes and matched the MP4 render manifest:

- `2c9ee57ad54cfacd92ec1496a098ca4106a185afa9f07961f121d5bb3435769f`
- `e386832be66aab9418f3ceb88d14d867b8f27fc0184ba022a75d53a5cb5c986d`
- `8a99d3516af67e4546dc0fc8bb0df873e09e378c0a6e903c712e5bd1c9dd5c36`

The temporary evidence JSON was written only to `/tmp/openfilm-m7a-ffmpeg-evidence.json`;
fixture media and project data are removed after tests. No private media or
credentials are used.

## Gate results

Local candidate verification passed:

- `pnpm format:check`, `pnpm test:i18n` (1,686 semantic keys), `pnpm lint`,
  `pnpm typecheck`, `pnpm build`: passed. Vite reports the existing 931 kB
  minified application chunk warning; build completes successfully.
- `pnpm test`: 210 files / 2,919 tests passed in 98.63 seconds, including the
  current lock, symlink and publication-race regressions.
- `pnpm test:e2e`: 168 tests passed in 15.4 minutes using Chromium from
  `/tmp/openfilm-playwright-browsers` and
  `PYTHONPATH=/tmp/openfilm-python-packages`. The initial run without that
  Python path passed 167 tests and failed only the Proposal test because
  `opentimelineio` was not on Python's module path; the corrected full rerun
  passed.
- `pnpm test:interchange`: 18 official parser tests passed; read/write/read,
  four synthetic source files, hashes/bounds, missing-source rejection and
  relocation checks passed. Real Resolve import remains unverified.
- Node 24.14 compatibility regression: 12/12 catalog and named-version tests
  passed using the project's supported minimum runtime.
- `pnpm test:native`: not run because `cargo`/Rust is not installed in this
  environment.

The first GitHub CI run exposed use of Node 24.19-only SQLite
`serialize()`/`deserialize()` methods although the project supports Node
24.14. The catalog now copies the main SQLite file after WAL checkpointing and
uses private file-backed connections for snapshot inspection. I reproduced the
original failure under Node 24.14, then verified the catalog and named-version
regressions pass under that exact runtime after the fix. The first browser run
exposed an outdated four-item navigation assertion and the missing optional
Python OTIO prerequisite. The navigation regression now expects and checks the
Versions entry; the pinned parser was installed only in `/tmp`. Exact-head CI
remains pending. Until it completes and review is resolved, this is locally
verified and not merge-approved. No hardware, Resolve, 4K or physical-display
behavior is inferred from synthetic tests.

## Manual gates

- Verify private-directory permissions, project relocation and recovery after a
  forced process interruption on supported Windows and macOS workstations.
- Review the restore confirmation and recovery workflow with a real project on
  each target desktop OS. Never use private project data in CI artifacts.
- Hardware performance, 4K restore/render throughput, real-film aesthetics and
  external NLE behavior are outside this candidate's automated evidence.
