# v0.5.0 source candidate: release-owner review

Status as of 2026-11-08: **technical gates passed; owner decision pending**.
PR [#129](https://github.com/bynanci/open-film/pull/129) remains Draft on the
historical `release/v0.5.0` track. No tag or Release has been created.

## Exact proposed delivery

- Candidate: `54534d8cf985203e8b5abbd09a771436f8fe09e5`.
- Release base: `d5a286ed9250872e8eb9b1c3e40adb926f913d34`.
- Scope: source archive only, preserving the staged v0.5.0 feature cut.
- All 22 workspace/Desktop/Tauri/Cargo version surfaces agree on 0.5.0.
- Source archive: `openfilm-v0.5.0-source-54534d8.tar.gz`, 5,116,663 bytes.
- Archive SHA-256: `40e170e682c1a518f16a572edddf0260247293c846986bd827582ba9b825e458`.
- Prepared evidence bundle: `openfilm-v0.5.0-owner-review-54534d8.zip`.
- Bundle SHA-256: `bc5fc729f880d119330c9e31d7b3cbd73d320a91179d422a3c230cc1b97a2cb6`.

These artifacts are prepared review inputs, not public release assets. The
[packet manifest](https://github.com/bynanci/open-film/blob/main/docs/evidence/releases/v0.5.0-owner-review.json)
records the exact lock hashes, version surfaces, CI identities, source archive,
proposed warning disposition and unverified native/physical claims. File names in
that manifest refer to the prepared packet. A matching source archive was
produced twice from the fixed commit/prefix/gzip timestamp and its digest agrees.
LICENSE, NOTICE and the complete vendored GLib LICENSE/COPYRIGHT are included.

## Candidate-bound technical evidence

| Gate                                      | Result / immutable run                                                                        |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| Complete Verify                           | [42493427242](https://github.com/bynanci/open-film/actions/runs/42493427242), all jobs passed |
| Security / actual native source admission | [42493427131](https://github.com/bynanci/open-film/actions/runs/42493427131), passed          |
| Windows Recovery                          | [42493427121](https://github.com/bynanci/open-film/actions/runs/42493427121), passed          |
| Linux/Windows/macOS Render QA             | [42493427234](https://github.com/bynanci/open-film/actions/runs/42493427234), passed          |
| DCO provenance                            | [42493424466](https://github.com/bynanci/open-film/actions/runs/42493424466), passed          |

Downloaded browser reports independently validate 313/313 passing cases, no
skip/retry, exact candidate and full coverage. Downloaded Render QA reports
validate 57 tests per platform, 180 decoded frames, PTS/RGB samples, decoded AAC
and unchanged synthetic sources; every report says `workstationVerified: false`.

Independent AI technical review of the adapted GLib repair returned **PASS**,
with no confirmed P0/P1/P2 finding. The
[retained path-free proof](https://github.com/bynanci/open-film/blob/main/docs/evidence/releases/v0.5.0-security-review.json)
binds the exact release candidate, authentic source/lock/feature closure, fresh
three-graph audits, 98 focused security tests and authenticated new native
artifact 13623121108. Its ZIP SHA-256 is
`e34686d33068c3eb202c952b03e672281558c8df4345b6d056c0d088d16b76cc`.
The reviewer checked five attributable pristine crashes, five patched and five
application passes, the actual native release build and ten independent binary
replays. No older main or pre-backport native receipt substitutes for this head.

The original upstream version remains GLib 0.18.5; its omission from a path-crate
scan is not the fix proof. Source reconstruction, optimized controls and raw
actual/registry/historical audit exits 0/1/1 jointly establish remediation. No
advisory ignore or unrelated package upgrade was introduced.

## Owner decisions still required

[Gate 5](validation-release-gates.md#gate-5-approve-and-publish) assigns the exact
candidate/artifact/scope decision to the release owner. AI technical review and
DCO do not record that decision. The prepared manifest keeps it `not-approved`.

The proc-macro-error RUSTSEC-2024-0370 maintenance warning remains visible. It
is Linux host procedural-macro tooling in the frozen GTK graph and is absent
from the inspected Windows/macOS resolved graphs. Proposed owner-review scope:
this frozen source/build graph, with expiry 2026-12-08 and recheck before
publication, on changed source/lock/features/compiler/target/candidate or a new
advisory/changed advisory semantics. No risk acceptance is inferred. Any
unresolved vulnerability or unsound source remains a blocking defect.

An approval must name the exact candidate, artifact hashes, source-only scope,
maintenance decision and recheck conditions. A later source SHA needs new checks
and a new decision. The release branch merge and eventual tag/publication retain
their explicit authorization requirements.

## Native distribution and real workstations

No installer is in this delivery. Actual audited runtime inputs, source/license
and SBOM review, installer hashes, Windows signing/macOS notarization, clean
first launch, update failure, rollback, project-preserving uninstall and real
Windows/macOS observations remain open. The current cloud instance has no
configured workstation VPN. The 1.1 workstation record now supports separate
platform gates and a standalone record tool; it supplies no observation itself.
Use the [M7E checklist](workstation-qa.md#m7e-native-installer-candidate) with the
actual target, package/runtime hashes and tester records. Resolve, GPU/4K,
external-media and listening claims remain under Issue #7.
