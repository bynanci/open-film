# OpenFilm

An open-source, local-first, story-first media composer. OpenFilm turns a local
collection of photos, video and audio into organized memories, a story and an
editable film. Original files are never modified.

**The current development tree includes OpenFilm 0.3.2 Shared Visual Geometry.** It builds on the localized product workflow and combines a Vue desktop workspace,
a CLI, browser-portable TypeScript algorithms, a local Node application service,
and SQLite storage. No cloud account or AI provider is required.

The current **photo-film quality** slice adds manual focal layouts, bounded still
motion, measured CJK graphic titles and music/narration overlays. A generated
twenty-second A/B film records actual rendered differences and audio automation;
local regression and UI results are recorded separately from candidate CI and
workstation verification.

**Film looks** add six original creative presets with adjustable strength, saved
whole-film/scene/clip overrides and an explicit MP4-only uniform output choice.
Source files stay untouched. Preview and rendering share versioned coefficients;
rendered output remains the color reference. See [the workflow and numerical
contract](docs/film-looks.md) and [open-source reference decisions](docs/film-look-open-source-reference.md).

**Native on-screen text** offers Regular/Bold weight, an end fade and a bottom
safe distance in Edit. The text and its background fade together while media
stays unchanged; defaults preserve older projects. See [native text controls](docs/native-text-controls.md).

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
- Preview subtitles from corrected transcripts against the current cut, then
  export SRT/WebVTT with a source-revision receipt in **Export → Subtitles**.
- Graphically trim video, set photo duration, reorder, adjust speed/volume and
  transforms, and choose cut/crossfade in a dark story-first timeline.
- Give photos contain, protected hero or explicit diptych layouts; use hold,
  gentle push-in or pan, and choose distinct film-title, scene and subtitle roles.
- Add imported music or narration over the existing cut, with clip-local fades,
  gain points and manual ducking, without moving pictures or extending the film.
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

The **0.3 Media Intelligence foundation** adds Precision mode inside Edit:
waveform, scene cuts, markers, snapping and transcript/word seeking. Trim and
split use existing composition history and autosave. FFmpeg powers waveform and
scene analysis; optional local Whisper requires an explicitly supplied model.
Cancelling transcription releases the project even if a provider ignores its
abort signal. Saved recognition and film edits remain intact; obsolete callbacks
and results cannot replace a successful retry. See [transcription](docs/transcription.md)
and the [product pain points](docs/product-pain-points.md).
No model is bundled or downloaded during recognition. See [media intelligence](docs/media-intelligence.md),
[transcription setup](docs/transcription.md) and [precision editing](docs/precision-editing.md).
This development milestone does not certify camera/GPU or real ASR quality.

Opening the film in another process preserves running media analysis. Activity
offers only actions this instance can perform; interrupted work has confirmed,
checkpoint-bound recovery that keeps saved recognition and manual edits. The
same [ownership and recovery contract](docs/media-analysis-recovery.md) is available
through the application, local API and CLI.

**0.3.1 Transcript Productivity** adds **Edit → Transcript**: correct text,
split/merge segments, search/replace and undo independently of the film timeline.
Immutable revisions preserve recognition evidence and mark edited word timing
as stale. Project/global terminology produces offline suggestions to preview,
accept or skip; optional language review uses the existing provider consent
boundary. See [transcript editing](docs/transcript-editing.md),
[glossary](docs/glossary.md), [review suggestions](docs/review-suggestions.md) and
the [validation record](docs/validation-transcript-productivity.md).

**0.3.2 Shared Visual Geometry** defines contain-fit, scale, clockwise rotation
and position in composition-frame pixels for the source preview and FFmpeg
renderer. The preview clips at the composition frame and follows inspector/layout
changes; rendering preserves transparent rotated corners above lower tracks.
See the [geometry contract](docs/architecture.md#shared-visual-geometry-contract)
and [validation record](docs/validation-geometry-parity.md). This is per-clip
geometry validation, not a claim of a full live multitrack compositor or real NLE QA.

The [performance and interaction refinement](docs/performance-interaction.md)
keeps Library startup independent of an unopened timeline, preserves recovered
drafts, and isolates waveform hover from read-only transcript rendering. Synthetic
browser fixtures measure work for 2,000 library assets, 500 clips and 10,000
transcript segments; these are UI measurements, not real-media throughput claims.

**Monitor stability and frame transport** keep FFmpeg overlays aligned to output
pixels/frame ticks and provide preview-only composition guides, frame stepping,
clip looping and quick transform controls in Edit. These controls reuse existing
composition commands; see the [validation record](docs/validation-monitor-stability.md).

**Composition-aware subtitles** reuse saved transcript revisions and one selected
dialogue/narration track. Trim, positive constant speed, gaps and repeated clip
instances use film time. Partial boundary segments are omitted with warnings;
edited word alignment is never presented as precise. No model, remote service,
caption track or burn-in is required. See [the workflow and limits](docs/composition-captions.md)
and [the pinned OpenCut reference](docs/opencut-reference.md).

**Scene-script planning:** use saved media
categories or chronology to draft editable scenes, narration and visual direction,
then review an actual solver-generated cut against the film's time limit. Accepting
creates a new Story and composition while preserving existing films. The offline
starters use declared classifications; they do not infer photo contents or generate
voice-over. See [the workflow and validation contract](docs/scene-script-planning.md).
The [validation record](docs/validation-scene-script-planning.md) separates
targeted results, initial full-suite failures and corrected UI checks. Complete
candidate CI/review is tracked in [TASKS](TASKS.md) and [PR #15](https://github.com/bynanci/open-film/pull/15/checks).

**Reviewable script suggestions** extend saved Story scenes with optional
LanguageProvider assistance. Choose Narration or Visual direction, compare the
original and suggested text with its reason, then Accept or Skip. Suggestions
and decisions survive reopening; source checks and acceptance receipts protect
manual edits and uncertain retries. Script review supports text-only providers
and uses existing remote consent. No provider is configured by default. See
[the workflow, privacy and recovery contract](docs/scene-script-review.md) and
[validation](docs/validation-scene-script-review.md).

**Photo-film quality:** manual composition controls now reach both the selected
photo monitor and FFmpeg output through shared geometry/time contracts. Local
font measurement produces the same graphic-title PNG for preview and rendering.
New graphic-title edits share the renderer's 8,000 UTF-16 code-unit input limit;
older longer titles remain readable for correction. Actual font/layout bounds
are checked separately before rasterization. Diptych edits check the gap against
the current composition width before saving.
Rendered MP4 sidecars retain the composition, source hashes, font identity,
encoding and warnings. [The contract](docs/photo-film-quality.md) and
[generated A/B validation](docs/validation-photo-film-quality.md) describe what
was actually measured. The fixture establishes rendered behavior; judging a
private film, listening to real audio and testing projection remain manual.

**Scene directions to edits:** save a supported direction such as
`保留比例；緩慢推近`, then select a photo in Edit and review the proposed
layout/motion with its reason and original phrase. Preview or skip individual
actions; adopt the safe selection as one saved, undoable batch. Unsupported prose,
conflicts, locks and existing manual presentation stay visible. Timing is unchanged;
stale reviews require regeneration. This is a bounded offline vocabulary, with no
image-understanding or arbitrary-language claim. The same review is available via
HTTP and CLI. See [the workflow and recovery contract](docs/scene-direction-editing.md)
and [validation](docs/validation-scene-direction-editing.md).

## Requirements

Use **Node 24.14.0 or newer** and **pnpm 11.11.0**. Node's built-in `node:sqlite`
is used directly and can emit an experimental API warning on Node 24.

Install FFmpeg and FFprobe on `PATH`; the sample workflow needs H.264/AAC encoding.
Graphic titles use locally installed fonts, measured by `fontkit` and rasterized
by `@resvg/resvg-js` in the local Node service. These are installed runtime
dependencies; the native font/raster loader does not enter the Desktop browser
bundle. Install a CJK font such as Noto Sans CJK for Traditional Chinese/Japanese
text, or explicitly configure `OPENFILM_TITLE_FONT` with a local font file.
No runtime font download is required. For richer
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
pnpm cli export --project /tmp/demo.openfilm --format mp4 --look soft-film --look-strength 0.7
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
[SECURITY.md](SECURITY.md). The current derivative distribution is [GPL-3.0-only](LICENSE), with prior Apache grants preserved in [the licensing record](docs/licensing.md); generated
sample media is dedicated to the public domain under CC0 1.0.

_Modified by OpenFilm contributors on 2026-10-18. Preexisting Apache-2.0 grants remain available; the current derivative distribution is GPL-3.0-only. See LICENSE and NOTICE._
