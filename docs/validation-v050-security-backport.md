# v0.5.0 GLib source-security backport

Pre-backport candidate: `04035f3266e191478296787982a46293177d61b2` on the
historical `release/v0.5.0` track. This repair carries only the GLib source fix
and its admission checks from reviewed main candidate PR #128; it does not merge
later main features into the release branch. PR #129 remains a source-only
candidate, without a tag, publication, native installer or workstation claim.

## Frozen inputs and bounded adaptation

The complete 121-file MIT GLib 0.18.5 crate, original archive, upstream gtk-rs
`05dff0ee696f9bcd8617cd48c4b812d046d440cb` patch, both source inventories and
five iterator probes are identical to PR #128's independently reviewed source.
The only crate source edits are `let p` to `let mut p` and `&p` to `&mut p`.
Full LICENSE/COPYRIGHT bytes and upstream version 0.18.5 are retained.

The source verifier pins this candidate's actual original registry Cargo lock:

- Base commit: `04035f3266e191478296787982a46293177d61b2`.
- Lock Git blob: `5074c730c731d3fccfc03fe8147d83ea7d81d439`.
- Lock SHA-256: `a808e238a30ca3088c0358728169d20c8cf9c5af4fbc417756227b9f602e23f4`.

The source verifier's baseline/lock/provenance/README anchors and closure's
required root version are adapted to **0.5.0**. Registry package versions remain
unchanged. The actual lock changes only the GLib path source and Linux-only test
dependency; its full original graph remains the control. Source trust anchors
are not loosened. The three-graph audit uses the release baseline, not main's
1.0.0 lock. The derived provenance labels the original source acquisition and
the new release lock baseline separately.

The native installer workflow depends on successful admission for the same
source SHA. A successful scanner exit alone does not authorize the path-patched
crate; complete source reconstruction, lock/feature closure, optimized attributed
pristine failures, patched/app passes and three same-database audits are required.
No installer workflow is dispatched by this backport.

## Local checks and fresh candidate gates

The transplanted 1.0 closure first rejected the real 0.5 lock as an unrelated lock
delta. After binding the verifier and control to the exact 0.5 baseline, all 98
focused source/closure/control/audit/admission tests and complete source
reconstruction passed. The original main review does not certify this adapted
candidate. Independent adaptation review, actual optimized controls and complete
CI must bind the new PR #129 head; the prior `04035f3` green checks are historical.

Keep the proc-macro-error RUSTSEC-2024-0370 maintenance warning visible for the
release-owner decision. Upstream GLib version 0.18.5 remains affected; the repair
relies on the reviewed exact source, not a changed version label or global
advisory ignore. Any changed source, dependency, feature, compiler, target,
advisory or candidate requires another applicable review and fresh checks.

Signing/notarization, reviewed runtime binaries and licenses/SBOM, clean-machine
installation, update/rollback/uninstall and physical Windows/macOS QA remain
separate M7E requirements. Approval of this source-only candidate cannot be
recorded as completion of those gates.
