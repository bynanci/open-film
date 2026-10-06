# OpenFilm

An open-source, local-first, story-first media composer. OpenFilm turns a local
collection of photos, video and audio into organized memories, a story and an
editable film. Original files are never modified.

**The current development tree includes the Global Product Experience and i18n round.** It combines a Vue desktop workspace,
a CLI, browser-portable TypeScript algorithms, a local Node application service,
and SQLite storage. No cloud account or AI provider is required.

```text
Create Film → Add Media → Organize → Story → Edit → Preview → Export
```

## What works

- Create and reopen versioned `.openfilm` projects with durable SQLite catalogs.
- Start from Welcome, choose film language and duration, and follow freely
  accessible workflow guidance through Library, Story, Edit and Export.
- Switch English, Traditional Chinese or Japanese without reloading; keep the
  film's language and custom story text independent from interface preferences.
- Import local images, video, and audio with per-file errors, cancellation, and
  resumable derived outputs; generate thumbnails and video proxies.
- Add folders, selected native files or browser-selected local copies; recover
  offline files without losing edits. Export a finished MP4 from the current cut.
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
- Graphically trim video, set photo duration, reorder, adjust speed/volume and
  transforms, and choose cut/crossfade in a dark story-first timeline.
- Undo/redo, lock important clips, regenerate one beat, review explainable Fit to
  target suggestions, and recover autosave failures without dropping the draft.
- Keep editing missing media, reconnect a moved folder or single file, and move
  projects with their cached thumbnails and proxies.
- Import Pixel metadata and Insta360 flat exports, recognize raw360 associations,
  and generate safe SDR previews for supported HEVC/HDR sources.

Start with the [Proposal Film reference workflow](docs/reference-workflows/proposal-film.md).
The [product workflow](docs/product-workflow.md) walks through the graphical flow;
[i18n](docs/i18n.md) describes language and template-text behavior.
Read [media portability](docs/media-portability.md) for offline/relink behavior,
[source support](docs/source-support.md) for camera limitations, and the
[desktop guide](apps/desktop/README.md) for shortcuts and save recovery.

## Requirements

Use **Node 24.14.0 or newer** and **pnpm 11.11.0**. Node's built-in `node:sqlite`
is used directly and can emit an experimental API warning on Node 24.

Install FFmpeg and FFprobe on `PATH`; the sample workflow needs H.264/AAC encoding
and the renderer's title support needs FFmpeg's `drawtext` filter. For richer
camera metadata, OpenFilm first tries `exiftool` on `PATH`, then its installed
`exiftool-vendored.pl` distribution through **Perl**. If both are unavailable,
FFprobe and filesystem timestamps provide a fallback recorded in metadata.
Codec availability depends on your FFmpeg build.
HDR previews require `zscale` and `tonemap`; the generated HDR regression suite
also uses the `libx265` encoder. Unsupported color metadata or filters produces
an explicit conversion instruction while preserving source metadata.

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

Run `pnpm dev` from the repository root and open the desktop development page.
Welcome offers Create Film and Open Project. Add memories, organize the library,
build a story, create the cut, then preview and export. The browser supports real
file selection and local copying; the Tauri shell adds native file/folder pickers.
See the [desktop guide](apps/desktop/README.md) for startup and native prerequisites.

### Engine and CLI workflow

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
project, add media, then use Library, Story, Edit and Export.

For the optional native shell, install Rust and your operating system's
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), then run:

```bash
pnpm --filter @openfilm/desktop tauri dev
```

The repository pins Rust 1.99.0 with `rustfmt` and `clippy` in
`rust-toolchain.toml`.

The shell supplies native folder and file pickers. Its development command starts the
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

OTIO carries native cuts/source references and exact original OpenFilm edit data.
Advanced edits are **metadata-only** and need manual recreation in Resolve;
the export report lists affected clips and any timing accommodation. Desktop and
CLI show the report, also saved beside the timeline as `.report.json`. Use the
OpenFilm MP4 preview as a visual/audio reference and JSON for complete edit data.
FCPXML/EDL continue rejecting unsupported edits. See the
[Resolve compatibility matrix and QA procedure](docs/nle-compatibility.md).
Official parser validation and actual NLE import are separate; real Resolve
import remains manual verification required.

If this computer cannot run Resolve, use the downloadable `resolve-qa-reference-…`
artifact from a successful [Verify run](https://github.com/bynanci/open-film/actions/workflows/ci.yml).
It contains generated media, portable fixture preparation, a manual import checklist
and an optional installed-Resolve API probe. Follow the
[workstation QA guide](docs/resolve-workstation-qa.md). A prepared bundle or successful
API check does not establish playback or effect fidelity.

## Develop and verify

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
python3 -m venv /tmp/openfilm-interchange-venv
/tmp/openfilm-interchange-venv/bin/python -m pip install opentimelineio==0.18.1
OPENFILM_OTIO_PYTHON=/tmp/openfilm-interchange-venv/bin/python pnpm test:e2e
```

Tests generate their own media, exercise actual FFmpeg/FFprobe and SQLite, verify
unchanged source hashes, and cover the browser workflow. `pnpm verify` runs lint,
type checking, Vitest, and build; browser tests and Rust checks are separate.
The Proposal browser workflow validates its exported file with the official OTIO
Python parser, so install it before running the complete browser suite.
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

See the [Global Product validation record](docs/validation-global-product.md)
for current regression coverage and manual checks. The
[Real Editing Workflow record](docs/validation-real-editing.md) and
[initial Linux record](docs/validation.md) are retained separately.

## Architecture and community

See [architecture](docs/architecture.md), [project format](docs/project-format.md),
[integration contracts](docs/CONTRACTS.md), [decisions](docs/adr/001-monorepo.md),
[roadmap](ROADMAP.md), and [task status](TASKS.md).
Contributions follow [CONTRIBUTING.md](CONTRIBUTING.md) and our
[Code of Conduct](CODE_OF_CONDUCT.md). Report security issues as described in
[SECURITY.md](SECURITY.md). Code is licensed under [Apache-2.0](LICENSE); generated
sample media is dedicated to the public domain under CC0 1.0.
