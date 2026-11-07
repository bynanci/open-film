# GLib 0.18.5 reviewed source inputs

The complete MIT-licensed registry crate is preserved in `vendor/glib-0.18.5/`.
Its version remains 0.18.5. The only modification applies upstream gtk-rs merge
05dff0ee696f9bcd8617cd48c4b812d046d440cb exactly: the C out pointer in
`VariantStrIter::impl_get` is mutable and passed by mutable reference.

The original archive, original upstream patch, canonical source inventories,
original application registry lock and provenance record are immutable review
inputs. The verifier reconstructs the expected patched tree from pinned archive
and patch hashes and compares every file, byte and Linux mode. Editing an
inventory cannot authorize different source. Changes to verifier trust anchors
require renewed independent provenance review.

Run `python3 scripts/security/verify-glib-source.py --repository . --output
/tmp/source.json` from the repository root. A source check does not establish
optimizer reproduction, advisory admission, installer trust or release approval.
RUSTSEC-2024-0429 still affects upstream version 0.18.5; both raw source-graph and
original-registry cargo-audit reports must remain visible.

Preserve full `LICENSE` and `COPYRIGHT` in the vendor root and all source headers.
MIT applies to this Rust crate; linked GNOME system libraries have separate
obligations, as the original COPYRIGHT explains. Inventories use UTF-8 JSON,
sorted keys, compact separators, byte-sorted relative paths and one final LF.
The registry control lock is the exact Cargo.lock Git blob
b4b8b94363f731001e2b42bf74778d79f725a1e4 from OpenFilm main at commit
73f9df9810770d52cab0cc2978e55ef8301f884e, never a synthetic lock. This
candidate changes only the GLib registry source and the Linux-only regression
test dependency; unrelated dependency versions remain identical to this base.

See the approved [design](../../docs/superpowers/specs/2026-10-30-d7b-native-remediation-design.md)
and [implementation plan](../../docs/superpowers/plans/2026-10-30-d7b-native-remediation.md).
