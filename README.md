# OpenFilm

An open media storytelling engine. OpenFilm turns a local collection of photos,
video, and audio into an organized library, a story plan, an editable rough cut,
and an MP4 preview. Original files stay in their source folders.

**0.1.0 is the first working vertical slice.** It combines a Vue desktop workspace,
a CLI, browser-portable TypeScript algorithms, a local Node application service,
and SQLite storage. No cloud account or AI provider is required.

```text
Folder → Metadata → Duplicates & Events → Story → Composition → Preview / Export
```

## What works

- Create and reopen versioned `.openfilm` projects with durable SQLite catalogs.
- Import local images, video, and audio with per-file errors, cancellation, and
  resumable derived outputs; generate thumbnails and video proxies.
- Resolve capture timestamps with source, confidence, and timezone uncertainty;
  detect exact duplicates and basic perceptual similarity; group events using
  time, GPS, and similarity.
- Browse a paginated chronological library, search/filter media, and edit ratings,
  favorites, rejection, and locks.
- Start a generic story or the external Proposal Film template; edit beat titles,
  intent, target durations, and required selections.
- Compose a timeline that respects duration maxima, beat minima, locks, required
  selections, exclusions, explicit order, source bounds, and no repeated assets.
- Render a local MP4 and export JSON, OpenTimelineIO, FCPXML, or applicable EDL.

The timeline model and renderer support trim, speed, volume, scale, rotation,
position, simple titles, and crossfade. These edits are currently accessible
through the SDK/project model; the desktop is a story and rough-cut workspace,
with a read-only timeline display, rather than a full timeline editor.

## Requirements

Use **Node 24.14.0 or newer** and **pnpm 11.11.0**. Node's built-in `node:sqlite`
is used directly and can emit an experimental API warning on Node 24.

Install FFmpeg and FFprobe on `PATH`; the sample workflow needs H.264/AAC encoding
and the renderer's title support needs FFmpeg's `drawtext` filter. For richer
camera metadata, OpenFilm first tries `exiftool` on `PATH`, then its installed
`exiftool-vendored.pl` distribution through **Perl**. If both are unavailable,
FFprobe and filesystem timestamps provide a fallback recorded in metadata.
Codec availability depends on your FFmpeg build.

```bash
node --version
pnpm --version
ffmpeg -version
ffprobe -version
perl -v
pnpm install --frozen-lockfile
```

Dependency installation requires network access. The basic media workflow runs
offline once dependencies and local tools are installed.

## Try a film

From the repository root, generate public-domain sample media into a separate
folder and run the real CLI:

```bash
node fixtures/sample-media/generate.mjs /tmp/openfilm-samples
pnpm cli create /tmp/demo.openfilm --title "A collection of moments"
pnpm cli import /tmp/openfilm-samples --project /tmp/demo.openfilm
pnpm cli list --project /tmp/demo.openfilm --offset 0 --limit 60
pnpm cli analyze --project /tmp/demo.openfilm
pnpm cli story generate --project /tmp/demo.openfilm --template proposal-film --target 12 --max 20
pnpm cli compose --project /tmp/demo.openfilm
pnpm cli render --project /tmp/demo.openfilm
pnpm cli export --project /tmp/demo.openfilm --format otio
```

The preview is `/tmp/demo.openfilm/cache/preview.mp4`; the exported timeline is
`/tmp/demo.openfilm/exports/timeline.otio`. Repeating import skips unchanged,
completed files. `Ctrl+C` cancels an import cooperatively. CLI results are JSON;
progress and command failures are written to stderr.

Use IDs from `list` to edit preference or choose a story scope:

```bash
pnpm cli rate <asset-id> --project /tmp/demo.openfilm --rating 5 --favorite --lock
pnpm cli rate <asset-id> --project /tmp/demo.openfilm --unlock --unfavorite
pnpm cli story generate --project /tmp/demo.openfilm --template blank --assets <id1>,<id2> --target 20 --max 30
pnpm cli --help
```

Story generation supports at most **2,000 candidates**, including locked assets.
Libraries above that size need an explicit `--assets` scope; the desktop can scope
a story to its displayed media page. This is a release limit, not a library-size
benchmark. The larger 10,000–100,000-asset ambition remains on the roadmap.
Target duration is a preference: a short source collection can produce a shorter
film. Hard minimum/maximum constraints and required selections produce actionable
errors when they cannot fit.

## Desktop development

```bash
pnpm dev
```

The application service binds to `127.0.0.1:4310`; Vite serves the interface at
`http://127.0.0.1:1420`. Open the interface in a local browser and create or open a
project, import a folder, then use Library, Stories, Timeline, and Export.

For the optional native shell, install Rust and your operating system's
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), then run:

```bash
pnpm --filter @openfilm/desktop tauri dev
```

The repository pins Rust 1.99.0 with `rustfmt` and `clippy` in
`rust-toolchain.toml`.

The shell supplies a native folder picker. Its development command starts the
same local service and interface. A native build can launch a supplied service
using absolute `OPENFILM_NODE_PATH` and `OPENFILM_SERVER_PATH` paths, or connect to
an already running service. **The native shell is not a self-contained installer:**
Node, the service bundle, media tools, and packaging still need deployment work.
Tauri installer bundling is disabled in this release.

## Exports

| Format         | Current behavior                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| JSON           | Preserves the complete composition, referenced asset descriptors, settings, and editing operations.                 |
| OpenTimelineIO | Exports cut tracks, source ranges, media URIs, and timeline gaps using rational times.                              |
| FCPXML 1.10    | Exports media resources, precise rational offsets, cut tracks, and connected lanes.                                 |
| CMX3600 EDL    | One video cut track, video sources, integer non-drop frame rates up to 60 fps, frame-aligned edits, and black gaps. |

NLE exports reject unsupported transforms, generated titles, transitions, and
overlapping clips within a track. They report what cannot be represented; use JSON
to preserve all edits. EDL also rejects still-image holds and multiple tracks.
Real-world import and round-trip validation across Resolve, Premiere, and Final
Cut remains release work; an exported file is not a compatibility certification.

## Develop and verify

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

Tests generate their own media, exercise actual FFmpeg/FFprobe and SQLite, verify
unchanged source hashes, and cover the browser workflow. `pnpm verify` runs lint,
type checking, Vitest, and build; browser tests and Rust checks are separate.
`pnpm build` creates `dist/cli/index.mjs`, `dist/server/index.mjs`, and
`apps/desktop/dist`. Run the built CLI with `node dist/cli/index.mjs --help`.

Additional release checks are:

```bash
node scripts/smoke-built-cli.mjs
python3 -m venv /tmp/openfilm-interchange-venv
/tmp/openfilm-interchange-venv/bin/python -m pip install opentimelineio==0.18.1
OPENFILM_OTIO_PYTHON=/tmp/openfilm-interchange-venv/bin/python pnpm test:interchange
pnpm test:native
```

The interchange check uses the official OTIO reader/write/read path and Python's
XML parser for resource/rational-time assertions. The native check needs the host
Tauri dependencies. The CI workflow runs these checks in addition to the browser
journey; source validation and a native build still differ from installer testing.

The initial Linux validation record is [documented here](docs/validation.md).

## Architecture and community

See [architecture](docs/architecture.md), [project format](docs/project-format.md),
[integration contracts](docs/CONTRACTS.md), [decisions](docs/adr/001-monorepo.md),
[roadmap](ROADMAP.md), and [task status](TASKS.md).
Contributions follow [CONTRIBUTING.md](CONTRIBUTING.md) and our
[Code of Conduct](CODE_OF_CONDUCT.md). Report security issues as described in
[SECURITY.md](SECURITY.md). Code is licensed under [Apache-2.0](LICENSE); generated
sample media is dedicated to the public domain under CC0 1.0.
