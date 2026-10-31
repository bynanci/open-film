---
layout: home

hero:
  name: OpenFilm
  text: From media to story to film
  tagline: An open-source, local-first media editor. Organize photos, video and recordings, shape a story, edit and export while keeping your originals intact.
  actions:
    - theme: brand
      text: Install and get started
      link: /en/getting-started
    - theme: alt
      text: Make your first film
      link: /en/product-workflow
    - theme: alt
      text: GitHub
      link: https://github.com/bynanci/open-film

features:
  - title: Local first
    details: The basic workflow needs no cloud account. Projects and media are managed locally; optional remote services require configuration and consent before data is sent.
  - title: Start with the story
    details: Organize moments, select important media and arrange beats before creating an editable cut.
  - title: Review before adopting
    details: Preview suggestions, confirm changes and keep control of the edit. Original photos, videos and recordings are not rewritten.
  - title: Portable work
    details: Export a playable MP4, or use supported interchange formats and media packages to continue working in other tools.
---

## Current availability

The latest published stable release is **v0.4.0**. `main` is unreleased development, and this site also documents those newer features. A distributable native desktop installer is not available yet; follow [Getting started](getting-started.md) to run from source. See [GitHub Releases](https://github.com/bynanci/open-film/releases) for release differences and the [Roadmap](https://github.com/bynanci/open-film/blob/main/ROADMAP.md) for future direction.

## Choose a starting point

| What you want to do                   | Start here                                                                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run OpenFilm on your computer         | [Requirements, setup and a first film](getting-started.md)                                                                                           |
| Complete a film                       | [Add media → Organize → Story → Edit → Export](product-workflow.md)                                                                                  |
| Check whether your media is supported | [Camera sources and preview limits](source-support.md)                                                                                               |
| Move a project or reconnect media     | [Media portability](media-portability.md), [Collect Media packages](collect-media.md)                                                                |
| Get help or contribute                | [Support](https://github.com/bynanci/open-film/blob/main/SUPPORT.md), [Contributing](https://github.com/bynanci/open-film/blob/main/CONTRIBUTING.md) |

## User guides

### Story and editing

[Story templates](creative-story-templates.md), [precision editing](precision-editing.md), [markers and snapping](markers-and-snapping.md), [audio quality](audio-quality.md) and [independent sound timing](audio-policy.md) explain the controls and their limits. Continue with [captions](composition-captions.md), [transcript editing](transcript-editing.md), [local presets](local-presets.md) and [named versions](named-versions.md) when you need them.

### Export and finishing

Use [export quality](export-quality.md) to choose MP4 settings and [Collect Media](collect-media.md) to prepare portable sources. Before moving to another editor, read the [NLE handoff guide](nle-handoff.md) and [compatibility guide](nle-compatibility.md). Interchange formats do not preserve every effect as an editable operation.

## Scope and limits

OpenFilm is designed for one user's local workstation. Basic import, story organization, editing and export do not depend on AI. Optional local models need additional setup; remote providers require explicit activation, data consent and their own service charges. See [transcription setup](transcription.md) and [speech generation](provider-generation.md).

Camera formats, hardware performance and external-editor compatibility have specific requirements. Check the relevant guide when a feature is unavailable. Development work and remaining release conditions are listed in [v1.0.0 readiness](roadmap/v1-readiness.md).

## Development, evidence and community

The code is licensed under [Apache-2.0](https://github.com/bynanci/open-film/blob/main/LICENSE). Read [architecture](architecture.md), [project format](project-format.md) and [integration contracts](CONTRACTS.md) to understand the design. Development setup, checks and submission instructions live in [Contributing](https://github.com/bynanci/open-film/blob/main/CONTRIBUTING.md).

Roadmaps, research and validation records preserve direction, hypotheses and execution evidence separately. The sidebar's validation section records the platform, commit, test results and outstanding manual checks for each run so that findings can be assessed and reproduced.

The main user guides have saved Traditional Chinese, English and Japanese versions. Some technical documents and historical validation records are maintained in English; see the [documentation language policy](i18n.md). Bug reports, documentation improvements, translations and code contributions are welcome. Use shareable reproduction media and omit private films, original paths and credentials from reports.
