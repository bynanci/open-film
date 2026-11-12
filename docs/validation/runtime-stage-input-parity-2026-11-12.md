# Reviewed runtime stage input parity — 2026-11-12

This scoped engineering change addresses the direct-entry inconsistency within
[issue #141](https://github.com/bynanci/open-film/issues/141). It does not approve
a distributable runtime or close the issue's source, licensing or OS gates.

## Source and behavior

The branch starts at main `81714e287a76aac1e46b6bea7e1806a408aa9a63`.
`stageRuntime` now calls the existing `inspectRuntimeInputs` whenever
`distributionReview` is supplied, immediately after the existing host/target
guard. Inspection precedes loading the exclusive directory renamer and creating
output parents, locks or staging directories. Supplied executables and notices
retain the same header, ordinary-file, parent-alias, size and SHA-256 checks as
the producer's existing intake. No tool is executed during inspection.

The registered producer already inspected inputs before staging. The original
reproduction therefore establishes a weaker direct entry point, not a complete
release-pipeline bypass. The generic file-copy helper remains unchanged: internal
dependency notice files and the explicit test-only FFmpeg fault wrapper retain
their existing controls. The later attribution, linkage, rights, source-hash and
actual-target checks remain mandatory.

```mermaid
flowchart LR
  A[Reviewed direct staging] --> B[Host and target guard]
  B --> C[Existing read-only input inspector]
  C --> D[Destination and staging work]
  D --> E[Existing attribution and linkage gates]
  E --> F[Independent rights and target acceptance]
```

## Regression evidence

All input fixtures are synthetic. Native files contain minimal host-format
headers; review and notice bytes explicitly confer no distribution rights.
The tests never invoke those files or a private media source.

| Check                               | Result                                                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Baseline before implementation      | Existing intake, support-file and real native-runtime integration: 3 files / 79 tests passed                    |
| New suite before production change  | 29 cases: 28 failed at the weaker entry point; valid-header control passed                                      |
| Existing suite after implementation | 79/79 passed; test-only staged FFmpeg wrapper remains exercised                                                 |
| Portable fixture follow-up          | 43/43 passed; canonical temporary root and host-format support headers preserve original assertions             |
| New suite after shared inspection   | 29/29 passed                                                                                                    |
| Hostile primary tools               | Node, FFmpeg and FFprobe: wrong OS with same CPU, executable script, hardlink and symlink-parent rejection      |
| Hostile primary notices             | Four primary notices: hardlink, symlink parent, empty and changed SHA-256 rejection                             |
| Side-effect assertions              | Exact inspector error, unchanged source bytes, absent output/parent/lock and no executed sentinel               |
| Positive control                    | Matching header/pins reach the existing missing repository LICENSE gate; this is not a complete-license fixture |

The commit-specific whole-repository verification and hosted checks are recorded
in the PR. A focused result is not substituted for those gates. No timeout,
assertion, dependency, scanner, compiler or platform pin is weakened by this
change. Local Node 24.19.0 and pnpm 11.19.0 differ from the pinned hosted
24.14.0/11.11.0 toolchain; the declared pins are unchanged.

## Remaining acceptance

Issue #141 remains open for actual reviewed target binaries, compiled-source and
build closure, notices/SPDX/source-offer or relink obligations and redistribution
approval. Issues #140, #142 and #143 retain final-candidate security receipts,
signed bytes and Windows/macOS trust, installation and lifecycle acceptance.
No native signing, source Release, repository-setting change or workstation
certification is performed by this patch.
