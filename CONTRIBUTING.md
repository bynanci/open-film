# Contributing to OpenFilm

[English](CONTRIBUTING.md) · [繁體中文](CONTRIBUTING.zh-TW.md) · [日本語](CONTRIBUTING.ja.md)

OpenFilm welcomes bug fixes, tests, documentation, reusable story templates and adapters. Keep changes focused on a user problem, explain the behavior that changes, and include evidence reviewers can reproduce.

## Propose and submit a change

- Use an issue for substantial feature work so scope, user need and constraints can be discussed first. Small, well-scoped fixes can go directly to a pull request.
- Work on a branch or fork and open a pull request against main. Keep each PR reviewable and state any compatibility, project-data or migration impact.
- Use the repository's pull request template. Report exact checks run and their results; identify checks and platform gates that were not run.
- Do not claim performance, creative quality or external-editor compatibility without reproducible evidence.

## Development workflow

Use Node.js 24.14.0 or newer, pnpm 11.11.0, FFmpeg and FFprobe. Perl or system ExifTool improves metadata extraction. Follow setup in the [README](README.md) and use pnpm install with the frozen lockfile for reproducible dependencies.

For relevant changes, run:

    pnpm lint
    pnpm format:check
    pnpm typecheck
    pnpm test
    pnpm build

For UI changes, run the browser suite after installing Playwright Chromium. For Rust changes, run cargo fmt, clippy with warnings denied and cargo test in apps/desktop/src-tauri; these require native host dependencies. Exporter changes should include the OpenTimelineIO interchange checks. Documentation changes should keep local links valid and run pnpm test:docs-i18n when README or localized guide files change.

In the PR description, list the exact commands, environment and concise results. Separate automated evidence from physical-device, private-media, hardware, NLE or editorial review that remains outstanding.

## Design boundaries

- Keep core models and algorithms independent of Vue, Tauri, Node, filesystem, SQLite and media executables. Put runtime integration in adapters.
- Reference originals and store edit operations. Never overwrite source media or silently discard edits during export.
- Validate public project/schema changes, document migrations and reject unknown versions rather than guessing.
- Preserve timestamp confidence, provenance and timezone uncertainty.
- Remote providers require explicit, scoped opt-in. The basic workflow stays local.
- Bound import work, paginate catalog reads, expose clear job states and return actionable errors.

See [architecture](docs/architecture.md) and [integration contracts](docs/CONTRACTS.md). Record substantial architecture changes in a short ADR under docs/adr/ with context, decision, consequences and validation needs.

## Documentation and evidence

Use the [documentation map](docs/index.md) to choose a category. User guides belong with the workflow they explain; architecture decisions go in docs/adr/; release notes go in docs/releases/; product research goes in research/; dated validation evidence stays in its existing validation record. The website sidebar groups these records without moving their source files, so existing links remain stable.

The official app and documentation locales are English, Traditional Chinese and Japanese. Keep the README and the main user guides aligned across these locales. Detailed contracts and validation evidence are maintained primarily in English; a translation may summarize and link to the canonical record, but must preserve commands, identifiers, measurements, commit references and test results. See the [language policy](docs/i18n.md).

Validation records describe one run. Preserve their commit, OS/tool versions, commands, results, failures and manual gates. Add later results as a new dated entry or record; update current status in ROADMAP.md and TASKS.md instead of rewriting old evidence. Redact private paths, credentials, GPS and non-shareable media.

## Tests and fixtures

Add focused regression coverage with behavior changes. Keep package-domain tests beside their package; use temporary directories and generated media from fixtures/sample-media/ for media/application integration. Browser tests should use the real local service. Check original hashes when changing import or rendering behavior.

Do not commit personal photos, faces, transcripts, GPS traces, credentials or private .openfilm projects. Use generated fixtures or media whose license permits redistribution, and include required attribution and license information.

## Conduct, security and licensing

Follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities using [SECURITY.md](SECURITY.md), not a public issue. Use [SUPPORT.md](SUPPORT.md) for product questions and the issue forms for bug reports or feature requests.

Unless explicitly stated otherwise, contributions submitted for inclusion are licensed under Apache-2.0. Confirm you have the right to contribute code and included media. Identify third-party material and preserve its license and attribution; contributing does not transfer copyright ownership. See [licensing](docs/licensing.md), LICENSE and NOTICE.
