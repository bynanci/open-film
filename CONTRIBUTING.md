# Contributing to OpenFilm

[English](CONTRIBUTING.md) · [繁體中文](CONTRIBUTING.zh-TW.md) · [日本語](CONTRIBUTING.ja.md)

You can help OpenFilm by improving a guide, translating a screen, reproducing a bug, or changing code. A useful contribution explains the problem and gives someone else a way to check the result.

## Choose a starting point

- **New to the project:** try the [source setup](README.md), correct an unclear instruction, or reproduce an existing issue with generated media.
- **Documentation and translation:** improve one guide or a few interface messages. Mention any related translation that still needs help.
- **Bug fixes:** describe the failing behavior and keep the fix focused. Add a regression test when it can demonstrate the bug.
- **New features or architecture changes:** open a [feature request](https://github.com/bynanci/open-film/issues/new?template=feature_request.yml) first to discuss the user need and scope before a large implementation.

Small fixes can go directly to a pull request. For usage questions, see [Support](SUPPORT.md). Report vulnerabilities through [Security](SECURITY.md), not a public bug report.

## Set up your workspace

The application uses Node.js **24.14.0 or newer** and pnpm **11.11.0**. Running media workflows also needs FFmpeg and FFprobe. Perl or a system ExifTool improves metadata extraction.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` starts the local service and browser workspace. It does not launch the native Tauri shell or create an installer. Native development has additional Rust and platform dependencies; follow the [desktop guide](apps/desktop/README.md).

The latest published release, **v0.4.0**, is a source release. `main` contains unreleased development, and signed Windows/macOS installers are not yet published. When reporting a result, identify the tag or commit you tested; an installer candidate is not a released installer.

### Documentation only

You do not need FFmpeg, Rust, or private media to improve documentation. The website has its own npm lockfile. Run these commands from the repository root:

```sh
npm --prefix docs ci
npm --prefix docs run build
pnpm test:docs-i18n
```

The first two commands are equivalent to `npm ci` and `npm run build` inside `docs/`. Do not replace `docs/package-lock.json` with a pnpm lockfile. If you only have Node and npm installed, `node scripts/check-doc-locales.mjs` runs the same locale check as `pnpm test:docs-i18n`.

## Check the part you changed

Choose checks that exercise your change. A documentation-only PR does not need local media, native, or external-editor QA. CI runs the repository's required checks independently.

| Change                                   | Useful local checks                                                                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Repository documentation or translations | Check links and language counterparts; run `pnpm test:docs-i18n`. Build the docs site for website content, links, navigation, or configuration changes.                                          |
| Interface translations                   | Run `pnpm test:i18n`; inspect affected screens for wrapping and missing messages.                                                                                                                |
| TypeScript logic or local service        | Run `pnpm lint`, `pnpm typecheck`, and the relevant Vitest tests. Use `pnpm test:contracts` for shared contract or schema changes.                                                               |
| UI behavior                              | Run the code checks above and the relevant Playwright spec; check keyboard interaction and any changed layout.                                                                                   |
| Media, import, or rendering              | Run the affected integration tests; use `pnpm test:media` for changes spanning the media pipeline. Verify source files remain unchanged where relevant.                                          |
| Export or interchange                    | Run exporter regressions and `pnpm test:interchange` when interchange behavior changes. See the [interchange setup](tests/interchange/resolve/README.md) for Python/OpenTimelineIO requirements. |
| Rust or native shell                     | Run `pnpm test:native` with the platform dependencies installed, then check the affected native behavior on that platform.                                                                       |
| Build or dependency configuration        | Run the relevant checks and `pnpm build`; include the platform and tool versions if they affect the result.                                                                                      |

For example, these commands run a focused domain test and a focused browser test:

```sh
pnpm exec vitest run packages/core/tests/timebase.test.ts
pnpm exec playwright install chromium
pnpm test:e2e tests/e2e/editing.spec.ts
```

Use the file relevant to your change. Browser tests require media tools and start their own local services; stop an existing `pnpm dev` first. On Linux, Playwright may also require system browser dependencies.

After installing the root dependencies, check formatting of changed files with `pnpm exec prettier --check <files>`; `pnpm format:check` checks the whole repository. For broad code changes, the full commands are `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.

Report the commands you actually ran and their results. If a relevant check needs hardware or software you do not have, say so in the PR. A passing parser test, browser suite, or Linux build does not establish a real Resolve import, native installer behavior, or camera-format compatibility.

## Open a pull request

1. Work on a fork or branch and target `main`.
2. Explain the problem, the resulting behavior, and the scope of the change. Link an issue if there is one.
3. List relevant checks and results. For UI changes, a screenshot or short recording can help; use shareable test material.
4. Mention project-format changes, migration needs, or known limitations. State which documentation or translations were updated.

Keep each PR small enough to review. You can open a draft while working or ask for help with a test or translation; you do not need to complete unrelated platform checks first.

## Development boundaries

- Keep domain models and algorithms independent of Vue, Tauri, Node, filesystem access, SQLite, and media executables. Put runtime integration in adapters.
- Reference original media and store edit operations. Do not overwrite sources or silently discard edits.
- Validate project and schema versions; document migrations and reject unsupported versions clearly.
- Preserve timestamp provenance, confidence, and timezone uncertainty.
- Keep the basic workflow local. Remote providers need explicit consent for the data and operation involved.
- Bound import work, paginate catalog reads, and make job states and recovery actions understandable.

See [architecture](docs/en/architecture.md) and [integration contracts](docs/en/CONTRACTS.md). For a substantial design change, add a short ADR under `docs/adr/` explaining the context, decision, and consequences.

## Documentation and test material

Use the [documentation map](docs/en/index.md) to find the right place. User guides explain workflows; `docs/adr/` records design decisions; `docs/releases/` records releases; `research/` holds product research.

Keep the main guides and repository handbooks aligned in English, Traditional Chinese, and Japanese. Each `README.md` has sibling `README.zh-TW.md` and `README.ja.md` files. Reference records under `docs/` also have English mirrors under `docs/en/`; update both when the locale check requires it. Preserve commands, identifiers, measurements, and evidence links in translations. See the [language policy](docs/en/i18n.md).

Dated validation records describe a specific run. Add new results as dated entries instead of rewriting old results; use the roadmap for current status. Record only the environment and evidence needed to support the claim.

Use generated fixtures from [sample media](fixtures/sample-media/README.md) or media licensed for redistribution. Do not commit personal footage, private projects, transcripts, GPS traces, or credentials. Redact names and personal paths in logs and screenshots. Include required attribution for any third-party media, fonts, models, or code.

## Conduct and licensing

Follow the [Code of Conduct](CODE_OF_CONDUCT.md). Unless explicitly stated otherwise, contributions submitted for inclusion are licensed under [Apache-2.0](LICENSE); you retain your copyright. Confirm you have the right to contribute the code and material, and preserve third-party licenses and attribution. See [LICENSE](LICENSE), [NOTICE](NOTICE), and the [licensing guide](docs/en/licensing.md).

## Contribution provenance and DCO

For contributions first submitted after this policy is adopted, every new commit must carry the contributor's own DCO 1.1 sign-off. Use `git commit -s` and read [DCO.md](DCO.md) before submitting. The sign-off confirms the right to contribute under the applicable open-source license; it does not assign copyright or grant exclusive commercial relicensing rights.

Before importing third-party or AI-assisted source, verify provenance, permission and required notices. If employer-owned code is involved, confirm authorization to contribute. See [GOVERNANCE.md](GOVERNANCE.md).
