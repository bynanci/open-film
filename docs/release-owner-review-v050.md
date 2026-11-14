# v0.5.0 source candidate: release-owner review

Updated 2026-11-14: the owner accepted [PR #129](https://github.com/bynanci/open-film/pull/129)
for a **source-only candidate branch merge** to `release/v0.5.0`; it merged as
`1b8d386e2a68b2448d20742138b4b100c799289b`. The owner also accepted the
disclosed `proc-macro-error` maintenance warning only as non-blocking for this
branch update. This does not approve a tag, GitHub Release, binary distribution,
native signing or workstation certification. No tag or Release has been created.
The current scoped decision is documented in
[PR #129](https://github.com/bynanci/open-film/pull/129); the detailed archive
reproduction record is included at
`docs/evidence/releases/v0.5.0-owner-disposition-2026-11-14.json` in this
documentation update. The prepared packet manifest below remains a historical
snapshot.

## Exact proposed delivery

- Candidate: `54534d8cf985203e8b5abbd09a771436f8fe09e5`.
- Release base: `d5a286ed9250872e8eb9b1c3e40adb926f913d34`.
- Scope: source archive only, preserving the staged v0.5.0 feature cut.
- All 22 workspace/Desktop/Tauri/Cargo version surfaces agree on 0.5.0.
- Source archive: `openfilm-v0.5.0-source-54534d8.tar.gz`, 5,116,663 bytes.
- Archive SHA-256: `40e170e682c1a518f16a572edddf0260247293c846986bd827582ba9b825e458`.
- Prepared evidence bundle: `openfilm-v0.5.0-owner-review-54534d8.zip`.
- Bundle SHA-256: `bc5fc729f880d119330c9e31d7b3cbd73d320a91179d422a3c230cc1b97a2cb6`.

These artifacts are historical prepared review inputs, not public release assets.
The original recorded archive digest is not claimed as freshly reproduced:
the 2026-11-14 reproduction using Git 2.52.0 / GNU gzip 1.13 produced 5,112,004
bytes with SHA-256
`1e8a7e458470b44abec7e4b88aa66c4d5faffa91b30db9f83f9ce0d34ddfe152`, different
from the earlier recorded 5,116,663-byte digest above. Independent inspection
matched all 1,417 tracked file contents to the candidate Git tree (zero missing,
extra or blob-mismatched files); this verifies source contents, not equality of
the compressed archive bytes. The original review ZIP was not retrieved or
reconstructed. The
[packet manifest](https://github.com/bynanci/open-film/blob/main/docs/evidence/releases/v0.5.0-owner-review.json)
records the exact lock hashes, version surfaces, CI identities, source archive,
proposed warning disposition and unverified native/physical claims. File names in
that manifest refer to the original prepared packet. LICENSE, NOTICE and the
complete vendored GLib LICENSE/COPYRIGHT are included.

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

## Owner disposition and remaining decisions

[Gate 5](validation-release-gates.md#gate-5-approve-and-publish) assigns the exact
candidate/artifact/scope decision to the release owner. The PR #129 merge records
the owner's scoped decision to update the source-only release branch. The
prepared manifest remains an immutable packet snapshot and still says
`not-approved`; it is not a current approval record.

The proc-macro-error RUSTSEC-2024-0370 maintenance warning remains visible. The
owner accepted it only as non-blocking for the source-only branch merge; this is
not binary-distribution risk acceptance. It
is Linux host procedural-macro tooling in the frozen GTK graph and is absent
from the inspected Windows/macOS resolved graphs. Proposed owner-review scope:
this frozen source/build graph, with expiry 2026-12-08 and recheck before
publication, on changed source/lock/features/compiler/target/candidate or a new
advisory/changed advisory semantics. Any unresolved vulnerability or unsound
source remains a blocking defect.

The old archive digest remains historical; no refreshed archive or review ZIP was
approved as a publication asset. Any future candidate SHA or publication requires
fresh checks, artifact hashes, a fresh security review and explicit owner
authorization.

## Native distribution and real workstations

No installer is in this delivery. Actual audited runtime inputs, source/license
and SBOM review, installer hashes, Windows signing/macOS notarization, clean
first launch, update failure, rollback, project-preserving uninstall and real
Windows/macOS observations remain open. No Windows/macOS workstation or
candidate was connected for this audit. The 1.1 workstation record now supports separate
platform gates and a standalone record tool; it supplies no observation itself.
Use the [M7E checklist](workstation-qa.md#m7e-native-installer-candidate) with the
actual target, package/runtime hashes and tester records. Resolve, GPU/4K,
external-media and listening claims remain under Issue #7.
