# D7B native remediation proposal

Status: parent selected Alternative A as the next separate implementation direction.
An independent implementation plan and provenance audit must precede vendoring;
no D7B product/dependency/CI change is part of this D7A branch. Base `e1255b1a8a83260149211d909cca8c1a50948c6b`;
application version0.4.0. This proposal is separate from D7A and does not close the
M7E, GLib, installer, signing or workstation checkboxes.

## Confirmed dependency and reachability evidence

`apps/desktop/src-tauri/Cargo.lock` resolves Tauri2.12.1, Tao0.37.1, Wry0.57.0,
GTK0.18.2, WebKit2GTK2.0.2 and GLib0.18.5. GLib's crate checksum is
`233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5`.
[RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html), alias
GHSA-wrw7-89jp-8q8g, is informational=unsound. It affects next/nth/last/next_back/
nth_back on VariantStrIter for >=0.15,<0.20 and is patched from0.20.0.

Official gtk-rs-core0.18 head `42b9caf98e03ded086362d9653ca58fe94dc8658` still
declares0.18.5 and passes &p to a mutating variadic out argument in
`glib/src/variant_iter.rs:118-130`. This can reach CStr::from_ptr(NULL) in optimized
builds. OpenFilm Rust sources contain no direct GLib/VariantStrIter/array_iter_str
use. Current upstream default-branch search found this constructor in GLib and
GIO examples, without production call sites in the searched Tauri/Wry/Tao/GTK/
WebKit repositories. That search is not exact locked-source or binary reachability
proof; retain the present uncertainty in the security review.

As of2026-10-30, stable Tauri2.12.5, Wry0.57.1 and Tao0.37.2 still require GTK^0.18;
WebKit2GTK2.0.2 requires the0.18 GLib/GIO/GDK/GTK series. GTK0.19.0 uses GLib^0.22
but is incompatible with that surrounding closure. Crates.io has no GLib0.18
release after0.18.5. A direct0.20 pin or lockfile edit is not a compatible repair.

`.github/workflows/security.yml:46` currently retains raw cargo-audit JSON and
prints informational warnings without denying unsoundness. No tracked deny.toml
or audit.toml was found. Scanner0.22.2 supports --deny unsound; current advisory
job success does not establish that the known unsound source is repaired.
`proc-macro-error`1.0.4/RUSTSEC-2024-0370 remains a separate unmaintained build
dependency notice; do not hide it as collateral to this remediation.

## Alternative A — Compatible audited upstream backport

Selected bounded code-remediation direction for a separate worktree. Its independent
implementation plan, provenance audit and source-aware evidence must precede closure. Preserve the actual crate version
0.18.5; do not manufacture an official0.18.6 release or claim a clean version scan.

Use the complete registry crate whose archive matches the lock checksum above,
retain its upstream MIT license/copyright, and apply only the upstream two-line
fix from [PR1343](https://github.com/gtk-rs/gtk-rs-core/pull/1343), merge commit
`05dff0ee696f9bcd8617cd48c4b812d046d440cb`: let p→let mut p, &p→&mut p in
VariantStrIter::impl_get. A vendored path patch is the proposed acquisition model;
no network Git dependency at build time and no version camouflage.

Before implementation, write the exact upstream archive/patch/tree provenance
record, file inventory and hashes; obtain the actual patch blob bytes and digest
from the fixed commit. This document has verified the commit/diff identity, not
downloaded and hashed a complete vendored crate or patch artifact. Never fill
missing digests with locally generated claims of independent review.

A source-aware verifier must fail closed unless all of these hold:

1. Cargo resolves the expected single GLib implementation and the compatible
   GTK/GIO/sys closure on the actual Linux target; no second unpatched0.18 copy.
2. The pristine archive, complete vendored file inventory and patched tree match
   reviewed hashes. The diff is exactly the approved upstream repair plus clearly
   separated provenance text; reject altered code, missing/extra files, symlinks,
   source substitutions and unknown patch versions.
3. Optimized tests exercise all five affected methods with actual nonempty string
   arrays: next, nth, last, next_back and nth_back, including mixed direction,
   UTF-8, empty/exhausted iterators and boundary indices. Demonstrate the pristine
   baseline failure or documented optimizer-dependent reproduction before the
   patched positive control; no crash/success inference from debug-only tests.
   Isolate each method's baseline probe so an early abort does not hide the other
   methods' coverage.
   Run release-mode checks at the project's Rust1.99.0 selection and record
   compiler, optimization profile, platform and exact source identity.
4. A fresh raw cargo-audit0.22.2 JSON report/database commit is retained for the
   actual resolved lockfile. Other vulnerabilities/unsoundness fail. For this
   specific finding, report upstreamVersionAffected=true and
   sourceRemediation=verified only when the verifier and optimized controls pass.
   Unknown/missing/changed audit output fails. A path patch can change scanner
   source matching: verify actual scanner behavior rather than assuming it will
   retain the registry warning. Also retain a fresh raw audit of the authentic
   pre-backport registry lockfile, bound to its original commit/blob/hash, as an
   explicitly labeled upstream reference. This keeps the raw known finding
   inspectable even if the resolved-path report omits it; the reference report
   is not represented as the currently built dependency graph.

Do not pass --ignore, drop warning records, rewrite upstream advisory ranges or
label the0.18.5 version scan clean. With --deny unsound the raw scanner may return
nonzero; capture/validate that expected failure explicitly and combine it with
source verification, rather than using unconditional shell success. An unchanged
or unverifiable0.18.5 tree must fail the combined gate. Independent review must
decide whether this source-evidence admission meets the existing distribution
criterion; the proposal alone does not alter that criterion.

Affected implementation paths would include Cargo.toml/lock, a narrowly scoped
vendored GLib source/provenance directory, source verifier and verifier fault
tests, optimized regression harness, security workflow path filters (including
manifest/vendor/verifier changes), security/native validation docs and M7E gate
reporting. No installer publication follows automatically from a repaired source.

## Alternative B — Coordinated supported upgrade

Wait for a released, compatible Tauri runtime/Wry/Tao/WebKit/GTK family using a
patched GLib series, then update the whole family and re-audit. This avoids owning
a source backport but has no verified available stable dependency route today.
GTK0.19 or GLib0.22 alone is insufficient. A prerelease shell migration is a
separate compatibility project, not a patch-level D7B substitution. Retain the
Linux distribution gate while continuing independent product/D7A work.

## Runtime, license, signing and physical obligations

Existing stage/verify/manifest/archive/owned-process tooling is usable candidate
infrastructure. Complete reviewed target-OS/architecture inputs for Node24.14+
on24.x, FFmpeg/FFprobe, font, fontkit/resvg/Koffi closure and missing full notices;
carry the reviewed distribution receipt and OS/shared-library baseline. Test-only
bundles must continue failing release admission. Current RuntimeInputs models
four tool files; any required DLL/dylib/so sidecars need the separately reviewed
manifest/staging/verifier contract or a proven portable tool selection.

The runtime SPDX inventory covers declared runtime components/copied npm closure;
it does not establish all compiled Rust or bundled frontend/service attributions.
Inventory those contributions for the actual shipped artifact. Retain OpenFilm
Apache-2.0/NOTICE and historical grants, GLib MIT, Node bundled notices, Noto OFL,
fontkit MIT, resvg MPL and Koffi's three MIT notices. Inspect the actual FFmpeg
build configuration/GPL version and satisfy Corresponding Source/source-offer
obligations; CI tool/font pins alone do not approve redistribution.

Windows/macOS signing identities and notarization are absent. Design the real
platform signing/trust pipeline when those identities exist; hash final signed/
stapled bytes afterwards. Keep default bundling disabled and manual candidate
workflow separate from releases. The dormant Ed25519 manifest verifier is not an
updater/downloader/activation/rollback implementation. Manual update/rollback is
the current contract; no automatic-update feature is implied by a v1 target.

Actual clean-machine/VM checks remain in `docs/workstation-qa.md:219-248`: normal
SmartScreen/Gatekeeper trust without bypass, non-admin account without developer
tools/fonts, WebView2/system libraries, long/CJK paths, first render/decode/reopen,
draft/close/crash ownership, corruption diagnostics, failed replacement, manual
rollback and uninstall preserving originals/managed media/snapshots/edits. Bind
all observations to full candidate/runtime/installer hashes, OS/build, arch and
signature status. Hosted Linux Rust/archive or Windows browser cases do not close
physical Windows10/popopc/macOS, Resolve,4K/GPU, long-session or display gates.
