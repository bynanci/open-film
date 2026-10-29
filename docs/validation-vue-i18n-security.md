# Vue I18n advisory remediation — 2026-10-29

Base: `c1d582b9b5ec8daadeab88048ac73d70999c8c39`.  
Dependency patch: `082c8fe5fa33cdc5a094ab5e2939f595feb89cde`.

This is a bounded production dependency correction for
[GHSA-83rm-6c8r-g728](https://github.com/advisories/GHSA-83rm-6c8r-g728)
and
[GHSA-8rc2-428q-7ww3](https://github.com/advisories/GHSA-8rc2-428q-7ww3).
The baseline `pnpm audit --prod --json` exited 1 with three High and two Low
findings across `vue-i18n`, `@intlify/core-base` and `@intlify/shared` 11.4.13.
Both advisories identify 11.4.14 as the first patched release on the supported
11.x line.

## Reachability and bounded change

The High advisory requires translation output to be rendered as HTML, for
example through `v-html`, with an affected message or untrusted interpolation
reaching an iframe `srcdoc`. The Low advisory additionally concerns calls that
combine list and named interpolation while parameter escaping is enabled.

Repository-wide searches found no production use of `v-html`, `srcdoc`,
`innerHTML`, `outerHTML` or `escapeParameter` under `apps/` or `packages/`.
The only source occurrence outside documentation is a Playwright diagnostic
that reads a control's `outerHTML`; it is neither production code nor a
translation rendering sink. Locale catalogs are bundled first-party modules.
The baseline is therefore a known vulnerable dependency graph without a
demonstrated OpenFilm input-to-HTML exploit path. This distinction does not
justify retaining a known vulnerable production dependency.

The change pins only `apps/desktop` from exact `vue-i18n` 11.4.13 to 11.4.14.
The lockfile updates the matching `@intlify/core-base`,
`@intlify/devtools-types`, `@intlify/message-compiler` and `@intlify/shared`
records, dependencies and integrity values to 11.4.14. An unrelated pnpm
rewrite of Volar's optional TypeScript peer metadata was removed; frozen
installation proves the scoped lock remains valid. No application API, locale
catalog, HTML-rendering option, project schema, media path, renderer or
first-party package version changes.

The npm registry reports the exact Vue I18n 11.4.14 integrity recorded in the
lockfile:

```text
sha512-oRFZtQjRDRQtfxu7tFlsZlnCa5gPkg/KX89kJDKdC9bz4GIYgo3cAMaD0XFeUx/WHuKoVbDMRTIo9Hvg67HnPw==
```

## Local validation

Environment: Node 24.19.0, pnpm 11.11.0, FFmpeg/FFprobe 7.1.5 and an isolated
Python 3.12 environment containing OpenTimelineIO 0.18.1. The repository
security workflow independently installs pinned pnpm 11.11.0 and Node 24.14.0
on pull requests that change a package manifest or lockfile.

| Check                                    | Result                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline production audit                | Failed as expected: 3 High and 2 Low findings on 11.4.13.                                                                                                                                                                                                                                                                             |
| Frozen patched install                   | Passed; all 21 workspaces were up to date and supply-chain policy validation accepted the scoped lockfile.                                                                                                                                                                                                                            |
| Patched resolution graph                 | Passed; Vue I18n and all four Intlify packages resolve to 11.4.14.                                                                                                                                                                                                                                                                    |
| `pnpm audit --prod`                      | Passed, exit 0: `No known vulnerabilities found`. No severity was ignored.                                                                                                                                                                                                                                                            |
| Translation/HTML sink inventory          | Passed for the advisory boundary: no production HTML translation sink or `escapeParameter` activation found.                                                                                                                                                                                                                          |
| `pnpm format:check`                      | Passed.                                                                                                                                                                                                                                                                                                                               |
| `pnpm test:i18n`                         | Passed: 2,383 semantic keys match across English, Traditional Chinese and Japanese; placeholders, errors and literal references validate.                                                                                                                                                                                             |
| `pnpm lint`                              | Passed with zero warnings.                                                                                                                                                                                                                                                                                                            |
| `pnpm typecheck`                         | Passed for TypeScript and Vue.                                                                                                                                                                                                                                                                                                        |
| `pnpm test` with OTIO 0.18.1             | Passed: 295 files, 4,243 tests. The same baseline command without the isolated OTIO interpreter had one environment failure in NLE handoff; its focused 60 tests pass with the documented interpreter.                                                                                                                                |
| `pnpm build`                             | Passed; Vite 8.2.4 transformed 290 modules. The existing 1.30 MB main-chunk warning remains and is not caused by this dependency patch.                                                                                                                                                                                               |
| `pnpm test:interchange` with OTIO 0.18.1 | Passed: 18 tests, real-source hashes/bounds and relocation. Real Resolve import remains unverified.                                                                                                                                                                                                                                   |
| `pnpm test:e2e` with OTIO 0.18.1         | Passed: 271 tests in 19.4 minutes with `OPENFILM_OTIO_PYTHON=/tmp/openfilm-otio-security/bin/python corepack pnpm test:e2e`. The first run passed 270 and failed only because the test runner used the default Python without OpenTimelineIO; the focused Proposal Film case and complete rerun pass with the documented interpreter. |
| `pnpm test:native`                       | Not run: Cargo, Rust, GTK 3 and WebKitGTK 4.1 prerequisites are absent in this environment.                                                                                                                                                                                                                                           |

The final pull-request head must repeat the dependency security workflow and
the hosted checks. A zero npm audit is not a security certification and does
not satisfy Issue #7's Resolve, real provider/model, GPU, camera, sustained 4K,
installer or Windows/macOS workstation gates.
