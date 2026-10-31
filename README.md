# OpenFilm

[English](README.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md)

[![Verify](https://github.com/bynanci/open-film/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/bynanci/open-film/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/bynanci/open-film)](https://github.com/bynanci/open-film/releases/latest)
[![License](https://img.shields.io/github/license/bynanci/open-film)](LICENSE)
[![Documentation](https://img.shields.io/badge/docs-online-2563eb)](https://bynanci.github.io/open-film/)

OpenFilm is an open-source, local-first media editor for turning photos, video and audio into a story and an editable film. It keeps original media untouched and does not require a cloud account.

## Project status

The latest published stable release is **v0.4.0**. The main branch is active, unreleased development; the accepted **v1.0.0** goal and remaining release gates are tracked in the [readiness roadmap](docs/roadmap/v1-readiness.md). A distributable native installer is not available yet.

## What you can do

- Import and organize local media in a project with a portable SQLite catalog.
- Shape a story, make a timeline edit, add captions and audio, and review changes before adopting them.
- Preview and export MP4, JSON and supported interchange formats. Advanced OTIO effects can require manual recreation in another editor; see the [compatibility guide](docs/nle-compatibility.md).
- Review saved edits with Visual QA, contact sheets and export reports; collect referenced media for relocation.
- Use the desktop workflow or CLI. Optional provider integrations are explicit; no AI provider is required for the basic workflow.

OpenFilm is designed for one user's local workstation, not as a multi-user or internet-facing service. Read the [security policy](SECURITY.md) before exposing local services or reviewing plugins.

## Build from source

Requirements: Node.js **24.14.0 or newer**, pnpm **11.11.0**, FFmpeg and FFprobe. Additional native-shell requirements are listed in the [desktop guide](apps/desktop/README.md).

    pnpm install --frozen-lockfile
    pnpm dev

This starts the local development workspace and application service. To explore the CLI:

    pnpm cli --help

For checks and focused test commands, see [Contributing](CONTRIBUTING.md). This source-development setup is not a packaged end-user installer.

## Documentation

The [documentation site](https://bynanci.github.io/open-film/) is available in **Traditional Chinese**, **English** and **Japanese**. Start with the [user workflow](docs/product-workflow.md) or browse the [documentation map](docs/index.md).

- Current status: [roadmap](ROADMAP.md), [v1.0.0 readiness](docs/roadmap/v1-readiness.md), [task status](TASKS.md)
- Design and interfaces: [architecture](docs/architecture.md), [project format](docs/project-format.md), [contracts](docs/CONTRACTS.md)
- Evidence: [release and validation records](docs/index.md)
- Research: [research index](research/README.md)

## Community

- [Contributing](CONTRIBUTING.md) · [Support](SUPPORT.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Report a security issue](SECURITY.md)
- [Open an issue](https://github.com/bynanci/open-film/issues/new/choose)

You may write community reports in English, Traditional Chinese or Japanese. Do not attach private media, project databases, original file paths, GPS data or credentials. Use generated fixtures or media you have permission to share.

## License

OpenFilm's first-party code is licensed under [Apache-2.0](LICENSE). Third-party components and media keep their own license terms; see [NOTICE](NOTICE) and the [licensing guide](docs/licensing.md).

OpenFilm's Apache-2.0 source may be forked and used commercially. For the
distinction between source rights and official project identity, see the
[branding policy](TRADEMARKS.md), [commercial use guide](COMMERCIAL.md) and
[project governance](GOVERNANCE.md). These documents do not amend Apache-2.0.
