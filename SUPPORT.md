# Getting help with OpenFilm

[English](SUPPORT.md) · [繁體中文](SUPPORT.zh-TW.md) · [日本語](SUPPORT.ja.md)

Start with the [user workflow](docs/en/product-workflow.md) or [documentation site](https://bynanci.github.io/open-film/en/). If something is unclear or does not work, you can ask in English, Traditional Chinese, or Japanese.

## Choose the right place

| You need help with                                       | Where to go                                                                                                                                                          |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup, usage, or whether something is supported          | Search [existing issues](https://github.com/bynanci/open-film/issues) for known problems, or ask in [Discussions](https://github.com/bynanci/open-film/discussions). |
| An error or behavior that differs from the documentation | Use the [bug report form](https://github.com/bynanci/open-film/issues/new?template=bug_report.yml).                                                                  |
| A new capability or a better workflow                    | Use the [feature request form](https://github.com/bynanci/open-film/issues/new?template=feature_request.yml) and explain the task you want to complete.              |
| A security vulnerability                                 | Follow [SECURITY.md](SECURITY.md). Keep vulnerability details out of public issues.                                                                                  |
| A community conduct concern                              | Follow the private reporting guidance in the [Code of Conduct](CODE_OF_CONDUCT.md).                                                                                  |

You do not need to know the cause before asking. If a similar issue already exists, add the details that are different in your environment.

## What to include

A short report is enough to start:

- What you were trying to do, what you expected, and what happened instead.
- The smallest steps that show the issue, including whether it happens every time.
- The release tag or commit, operating system, and how you launched OpenFilm: browser development workspace, native development shell, CLI, or an installer candidate.
- A short error message, redacted log excerpt, or screenshot if useful. For media-specific issues, include the format, codec, dimensions, and duration when known.

If you do not know a version or media property, say so. You do not need to attach a complete project or personal footage. For source checkouts, `git rev-parse --short HEAD` identifies the commit.

## Release and platform status

The latest published release, **v0.4.0**, is a source release. `main` is active, unreleased development. Signed Windows/macOS installers are not yet published; a manually generated installer candidate is not a stable release.

`pnpm dev` starts a browser workspace with a local service. Native-shell development has separate requirements in the [desktop guide](apps/desktop/README.md). Check the [roadmap](ROADMAP.md) and [release readiness](docs/roadmap/v1-readiness.md) for remaining platform work. External-editor limitations are documented in the [NLE compatibility guide](docs/en/nle-compatibility.md).

## Share only what is needed

Projects, logs, screenshots, and media metadata can expose names, paths, capture dates, GPS, transcripts, or credentials. Remove those details before posting publicly. Avoid uploading project databases or full logs; use generated test material or the smallest sample you have permission to share.

For suspected data loss, preserve the original media and project before further experiments. Close OpenFilm before making a filesystem copy of a project, or use SQLite-aware backup tools; see [project handling](SECURITY.md#privacy-and-project-handling). Some sources may be referenced outside the project. Preserve and back up both the project directory and those referenced sources. Browser-managed copies and collected packages may include media.

## Community support

OpenFilm is community-maintained. Replies depend on maintainer and contributor availability; there is no guaranteed response time or paid support program. Reports with clear steps help others investigate. If you find the solution, add it to the issue so the next person can benefit.

To help with documentation, reproduction, or a fix, see [Contributing](CONTRIBUTING.md).
