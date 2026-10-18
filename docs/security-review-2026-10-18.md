# Security review — 2026-10-18

Base: `90921dc4546ad58efc612b1c79f40ffa66ffb043`.
Candidate branch: `codex/film-look-presets`. This is a bounded source/dependency
review and regression exercise, not a penetration-test certification.

## Findings and remediation evidence

| Finding                                              | Evidence                                                                                                                                                                                     | Response                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Known Vue SSR dependency defect, GHSA-g2v6-rqmx-r4w6 | `pnpm audit --json` found `@vue/server-renderer` 3.5.41 through Vue. A public-helper test reproduced carriage-return acceptance in attribute names; the normal escaped-value control passed. | Upgrade the direct Vue pin to 3.5.42 with its matching transitive packages. Both helper tests pass; fresh audit reports zero known npm vulnerabilities. OpenFilm uses client rendering, and no current application SSR route was found. Do not report an existing OpenFilm SSR exploit.                                 |
| Non-self-contained source decoding                   | A supported filename can contain a playlist/manifest whose decoded media is another file. Source provenance can then hash the document rather than all decoded bytes.                        | Shared input protocol/demuxer restrictions cover import, derivatives, intelligence, source adapters and renderer. Benign generated local fixtures first reproduced acceptance, then verified rejection without private files or external requests. Focused FFmpeg 7 checks passed 222 tests; FFmpeg 6 checks passed 75. |
| Native Linux transitive advisories                   | `cargo-audit` 0.22.2, RustSec database `999ec89d5d3f10f20be14750ec8c2d8b44e0ac9b`: zero entries in the vulnerability category, plus the two informational notices below.                     | Retain warnings and track upstream dependency work. A zero vulnerability count does not erase an unsoundness warning.                                                                                                                                                                                                   |

### Rust warnings retained

- `RUSTSEC-2024-0429`: `glib` 0.18.5 has unsound `VariantStrIter` iterator methods;
  patched from 0.20.0. This is in the Linux Tauri/GTK dependency chain. No direct
  use of that iterator was found in OpenFilm's Rust commands; transitive
  reachability is not certified. Replacing GTK's required GLib series with an
  incompatible minor version is not a safe lockfile-only fix. Track an upstream
  compatible dependency update and re-audit before Linux installer release.
- `RUSTSEC-2024-0370`: `proc-macro-error` 1.0.4 is unmaintained, a build dependency
  notice without a patched version in the advisory. Track replacement through
  the upstream dependency chain.

## Boundaries reviewed

Independent source review traced exact Host and fixed Origin checks, loopback
binding, bounded JSON-only mutations, upload receipts, project/cache symlinks,
source/download confinement and provider consent. No high-confidence vulnerability
was found in those reviewed paths. Additional HTTP regressions cover forged and
rebinding Host values, forwarding-header bypass attempts and null origins, while
retaining valid desktop-origin controls. Eight tests in that suite passed.

Runtime review found argument-array child execution and numeric font-glyph SVG
generation; no shell/title injection was confirmed. Providers and plugins remain
trusted code, not sandboxed processes. Remote consent still binds destination,
provider identity and declared data kinds. Film-look inputs are finite numeric
values and fixed preset IDs; source paths do not enter generated shell commands.

## Gates and remaining limits

Full candidate regression and exact-head CI are recorded with the feature PR.
The initial full Vitest run exposed 36 failing extracted-component harness tests
whose dependency hosts omitted new look refs/helpers. Their three hosts were
updated without removing assertions; all 118 focused tests then passed. This
failure was not counted as a successful full run.

The new advisory workflow retains JSON reports and fails on detected dependency
vulnerabilities. Database/network failures also fail the check rather than becoming
clean results. Audit does not scan system FFmpeg, ExifTool, WebView or OS binaries.
Real installers, hostile-media decoder fuzzing, platform hardening and independent
professional penetration testing remain separate work. Security fixes do not
close camera/HDR/Resolve/workstation appearance or performance gates.
