# GLib RUSTSEC-2024-0429 independent technical disposition

Reviewed 2026-11-08 by an independent AI technical reviewer who did not implement
PR #128. The recommendation is **PASS**, with no confirmed P0/P1/P2 findings,
for head `3b05ba781b62494143e2d73ba6126a9e1f24d43e`, based on
`73f9df9810770d52cab0cc2978e55ef8301f884e`. This is a technical source-remediation
review, not a human approval, release-owner decision, risk acceptance or installer
certification. The [path-free review proof](https://github.com/bynanci/open-film/blob/main/docs/evidence/native-installer/glib-independent-review-2026-11-08.json)
retains the reviewed identities and unedited parsed audit reports with the hashes
of their original stdout bytes.

## Source, closure and execution

The reviewer freshly acquired the authentic crate, upstream patch, fixed source
and RustSec advisory. The complete 121-file MIT crate was independently compared
with the archive. Only `src/variant_iter.rs` differs: `let p` becomes `let mut p`,
and the C out-argument is passed as `&mut p`. The vendored file is byte-identical
to gtk-rs merge `05dff0ee696f9bcd8617cd48c4b812d046d440cb`; full LICENSE and
COPYRIGHT bytes remain unchanged. The upstream crate version remains 0.18.5.

All 431 lock entries were compared: only the GLib source/checksum and the
application's Linux test dependency change. The Linux normal/build graph reaches
the reviewed path crate and uses the same 49 transitive package/source/feature
identities as both isolated controls. GLib and proc-macro-error are absent from
the resolved Windows x64 MSVC and macOS arm64 normal/build/dev graphs. Linux
proc-macro-error 1.0.4 is host procedural-macro tooling through glib-macros and
gtk3-macros; this classification is not a claim that unmaintained code is safe.

Exact-head [native admission run 42359357894](https://github.com/bynanci/open-film/actions/runs/42359357894)
passed the optimized pristine/patched/application controls and native release
build. The reviewer authenticated artifact 13569073330 against the API digest:
`ec1c4efe77e3391bbaaac8f79c171f8cdb6fce294935d74eae78cee135584302`.
They checked 57 log/binary hashes and five debugger traces attributing pristine
failures to `strlen` with a null pointer and the affected iterator on the stack.
They also independently replayed the downloaded pristine and patched executables:
five pristine SIGSEGV results and five patched passes. Actual application probes
were checked in the hosted raw logs; no local native application rebuild is claimed.

## Fresh audit and informational warnings

At 2026-11-08T14:51:33Z the reviewer independently fetched RustSec DB
`309392b18f6b17022f82c701f300433126901068` (1,422 advisories), then ran
cargo-audit 0.22.2 against three graphs using that one database and
`--deny unsound`. Expected process results were 0/1/1:

| Graph                               | Exit | Disposition                                                    |
| ----------------------------------- | ---: | -------------------------------------------------------------- |
| Actual path-patched app             |    0 | No vulnerability/unsound finding; maintenance warning retained |
| Current equivalent registry control |    1 | GLib RUSTSEC-2024-0429 remains visible                         |
| Exact original registry lock        |    1 | Same GLib finding remains visible                              |

Every report has empty `settings.ignore`, no target/severity suppression, and
retains proc-macro-error RUSTSEC-2024-0370 as an unmaintained warning. A path
crate's omission from the default audit does not prove a fix: acceptance combines
authenticated source reconstruction, locked closure, attributed optimized
controls and the three raw audits. All 98 focused source/closure/control/audit/
admission tests passed independently.

The maintenance warning remains an explicit release-owner review item. Proposed
scope: frozen Linux build tooling only; no replacement or broad GTK-family
upgrade in this repair. Recheck on any source, lock, feature, compiler, target or
candidate change, new advisory, or before a release. No owner acceptance is
recorded by this document.

## Synchronization and limits

Main `6f916cb061fb3b973a23961745429869fd8380af` changes no Cargo/native/security
baseline relative to the reviewed base. The reviewer verified that synchronized
head `2fac32622fce68f1ec69033c6cd6280dbc0baa39` has no security implementation,
Cargo, vendor, provenance or relevant workflow delta from the reviewed head. The
coordinator reran the 98 focused tests and source verifier on that synchronized
head. Full hosted checks and admission must still bind the final PR head; the
original run is not relabeled as its result.

This review does not transfer automatically to the historical v0.5.0 candidate.
That candidate must preserve its own version and original lock identity, apply
the same source fix, and obtain its own closure/controls/audits and CI. Signed
installers, trust/notarization, clean-machine first launch, update/rollback,
uninstall, physical workstation observations and runtime license/source-obligation
approval remain separate [release gates](../validation-release-gates.md).
