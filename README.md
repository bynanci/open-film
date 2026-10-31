# OpenFilm

[English](README.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md)

[![Verify](https://github.com/bynanci/open-film/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/bynanci/open-film/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/bynanci/open-film)](https://github.com/bynanci/open-film/releases/latest)
[![License](https://img.shields.io/github/license/bynanci/open-film)](LICENSE)
[![Documentation](https://img.shields.io/badge/docs-online-2563eb)](https://bynanci.github.io/open-film/)

**Turn your photos, video and audio into a story you can edit.**

OpenFilm is an open-source, local-first media editor. Organize scattered media,
plan a story, build a rough cut and refine it in one project. Your original media
stays untouched, and the basic workflow runs without a cloud account or an AI
provider. Supported interchange formats let you continue finishing in another
editor.

[Read the documentation](https://bynanci.github.io/open-film/en/) ·
[Follow the roadmap](ROADMAP.md) ·
[Contribute](CONTRIBUTING.md)

## What you can do

- **Organize your media.** Import local files and folders, inspect metadata,
  review duplicate and event suggestions, and keep selections in a portable
  SQLite catalog.
- **Shape the story.** Start with a story structure or your own outline. Use
  Story Graph and Storyboard to connect ideas, choose media and review a
  duration-aware rough cut.
- **Keep control of the edit.** Refine clips, photos, titles, captions and audio
  with non-destructive commands, locks, Undo/Redo and saved project versions.
- **Review automation.** Follow Pipeline steps, inspect proposed changes and
  compare creative variants before accepting them. Optional local or remote
  providers extend the workflow with explicit setup and consent.
- **Preview and deliver.** Render MP4, export stills and audio, or hand off an
  editable cut through supported interchange formats. Visual QA and export
  reports make output limitations visible.
- **Keep the project portable.** Relink moved sources and collect referenced
  media for relocation. Use the graphical workspace, CLI or local API over the
  same application services.

These capabilities describe the current development branch. See the
[workflow guide](docs/en/product-workflow.md) for a complete path through the app
and the [compatibility guide](docs/nle-compatibility.md) for NLE handoff limits.
Some effects require baking or manual recreation in the destination editor.

## Project status

| Channel                                                            | What to expect                                                                                                       |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| [v0.4.0](https://github.com/bynanci/open-film/releases/tag/v0.4.0) | Latest published stable **source release**. Read its release notes for the included scope.                           |
| `main`                                                             | Active development toward v1.0.0, including changes newer than the published release.                                |
| Native installers                                                  | Not available for distribution yet. Runtime packaging, signing and clean-machine checks remain release requirements. |

The [v1.0.0 readiness roadmap](docs/roadmap/v1-readiness.md) records remaining
editing work, native distribution requirements and workstation validation.
Physical playback, audio, display and NLE checks are tracked separately from
automated tests.

OpenFilm currently targets one user's local workstation. The local API is not a
multi-user or internet-facing service; see the [security policy](SECURITY.md)
for its supported boundary.

## Run from source

### Prerequisites

- Git
- Node.js **24.14.0 or newer**
- pnpm **11.11.0**, as pinned in `package.json`
- FFmpeg and FFprobe available on your `PATH`

The browser-based development workspace does not require Rust. Native-shell
development has additional platform requirements in the
[desktop guide](apps/desktop/README.md).

### Start the development workspace

```sh
git clone https://github.com/bynanci/open-film.git
cd open-film
pnpm install --frozen-lockfile
pnpm dev
```

Open **[http://127.0.0.1:1420](http://127.0.0.1:1420)** in your browser. The command
starts the local application service on port `4310` and the workspace on port
`1420`; keep that terminal running. Create a film, import a small media selection,
then follow **Library → Story → Edit → Export**. Press `Ctrl+C` to stop the
development processes.

To explore the CLI from the repository root:

```sh
pnpm cli --help
```

<<<<<<< HEAD
This checkout runs `main`. For a released baseline, select the
[v0.4.0 source release](https://github.com/bynanci/open-film/releases/tag/v0.4.0)
and follow the instructions in that revision. Building from source does not
produce a verified end-user installer.

## Find the right documentation

| You want to…                                 | Start here                                                                                                                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Make your first film                         | [Getting started](docs/en/getting-started.md), [user workflow](docs/en/product-workflow.md) and [documentation index](docs/en/index.md)         |
| Try a reproducible example                   | [Proposal film reference workflow](docs/reference-workflows/proposal-film.md), using generated media                                            |
| Move a project or continue in another editor | [Media portability](docs/en/media-portability.md), [Collect Media](docs/en/collect-media.md) and [NLE compatibility](docs/nle-compatibility.md) |
| Understand the product direction             | [Project vision](docs/PROJECT_BRIEF.md), [roadmap](ROADMAP.md) and [task status](TASKS.md)                                                      |
| Work on the implementation                   | [Architecture](docs/architecture.md), [project format](docs/en/project-format.md) and [contracts](docs/CONTRACTS.md)                            |
| Check release readiness or research          | [v1 readiness](docs/roadmap/v1-readiness.md), [validation records](docs/en/index.md) and [research index](research/README.md)                   |

User guides are available in English, Traditional Chinese and Japanese.
Technical reference and validation records are primarily maintained in English;
the [language policy](docs/en/i18n.md) explains the coverage.

## Contributing and community

Bug reports, documentation improvements, translations, reproducible media cases
and code contributions are welcome. Start with [Contributing](CONTRIBUTING.md)
for setup, checks and the pull request workflow. For larger changes, open a
discussion or issue to agree on scope and the existing component that owns it.

- [Ask a question or discuss an idea](https://github.com/bynanci/open-film/discussions)
- [Report a bug or request a feature](https://github.com/bynanci/open-film/issues/new/choose)
- [Get support](SUPPORT.md) · [Code of Conduct](CODE_OF_CONDUCT.md)
- [Report a security issue privately](SECURITY.md)

You can participate in English, Traditional Chinese or Japanese. Use generated
fixtures or media you have permission to share in reports. Keep private media,
project databases, source paths, GPS data and credentials out of public issues.

## License and optional services

The current local features are free to use. OpenFilm's first-party source is
licensed under [Apache-2.0](LICENSE), which permits commercial use, modification
and redistribution under its terms. See [NOTICE](NOTICE) and the
[licensing guide](docs/licensing.md) for attribution and third-party obligations.

OpenFilm's Apache-2.0 source may be forked and used commercially. For the
distinction between source rights and official project identity, see the
[branding policy](TRADEMARKS.md), [commercial use guide](COMMERCIAL.md) and
[project governance](GOVERNANCE.md). These documents do not amend Apache-2.0.

Optional external AI services may charge their own fees. If you configure a
provider with your own API key, its usage is billed by that provider; it is not
included with OpenFilm. The basic local workflow does not need those services.
Your media, fonts, model weights and other third-party materials retain their
own licenses.
