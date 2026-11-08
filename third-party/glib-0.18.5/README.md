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
5074c730c731d3fccfc03fe8147d83ea7d81d439 from the pre-backport v0.5.0 source candidate at commit
04035f3266e191478296787982a46293177d61b2, never a synthetic lock. This
candidate changes only the GLib registry source and the Linux-only regression
test dependency; unrelated dependency versions remain identical to this base.

See the [v0.5.0 security backport validation](../../docs/validation-v050-security-backport.md).
