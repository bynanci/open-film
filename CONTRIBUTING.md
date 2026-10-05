# Contributing to OpenFilm

OpenFilm welcomes fixes, tests, documentation, reusable story templates, and
adapters. Keep a change tied to a concrete media or storytelling problem, and
describe its visible behavior and validation in the pull request.

## Development workflow

Use the existing checkout with Node 24.14.0 or newer, pnpm 11.11.0, FFmpeg,
FFprobe, and Perl or system ExifTool. Follow the setup and sample workflow in
[README.md](README.md). Use `pnpm install --frozen-lockfile` for a reproducible
installation; update the lockfile deliberately when changing dependencies.

Before requesting review, run the checks relevant to your change:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

Run `pnpm test:e2e` for UI/application changes after installing Playwright
Chromium. For Rust changes, run `cargo fmt --check`, `cargo clippy -- -D warnings`,
and `cargo test` in `apps/desktop/src-tauri`; these require Tauri host dependencies.
State which checks ran, their results, and any untested host-specific behavior.

Run `pnpm test:interchange` for exporter changes with Python OpenTimelineIO 0.18.1
installed; `OPENFILM_OTIO_PYTHON` selects its Python executable. After building,
`node scripts/smoke-built-cli.mjs` exercises the bundled CLI. `pnpm test:native`
runs the repository's Rust formatting/lint/test checks with its pinned toolchain.

## Design boundaries

- Keep core models and algorithms independent of Vue, Tauri, Node, filesystem,
  SQLite, and media executables. Place runtime integration in adapters.
- Reference originals and store edit operations. Never overwrite source files or
  silently discard edits during export.
- Keep scenario-specific vocabulary and policy in external template packages.
- Validate public project/schema changes, document migrations, and reject unknown
  versions rather than guessing. All durations are seconds.
- Preserve timestamp confidence, provenance, and timezone uncertainty.
- Remote providers require explicit, scoped opt-in. Default workflows stay offline.
- Use bounded import work, paginated catalog reads, clear job states, and actionable
  errors. Avoid eager decoding of entire collections.

[Architecture](docs/architecture.md) and [integration contracts](docs/CONTRACTS.md)
describe the current boundaries. Record substantial changes in a short ADR under
`docs/adr/` that states context, decision, consequences, and validation needed.

## Tests and fixtures

Write tests that can fail when the requested behavior breaks. Domain tests belong
beside their package; media/application integration tests should use temporary
directories and the generator in `fixtures/sample-media/`. Browser tests use the
real local service. Check original hashes when touching import or rendering.

Do not commit personal photos, faces, transcripts, GPS traces, credentials, or
private `.openfilm` projects. Use generated fixtures or media whose license allows
redistribution, and include attribution/license information when required.

## Contributions and reporting

Use an issue to explain a substantial feature's use case and constraints; small
fixes can go straight to a pull request. Include a before/after example where it
helps reviewers. Do not claim benchmarks or NLE compatibility without reproducible
evidence. Follow [the Code of Conduct](CODE_OF_CONDUCT.md), and use the private
reporting guidance in [SECURITY.md](SECURITY.md) for vulnerabilities.

Unless explicitly stated otherwise, contributions are submitted under the
repository's Apache-2.0 license. Confirm that you have the right to contribute
the code and any included media.
