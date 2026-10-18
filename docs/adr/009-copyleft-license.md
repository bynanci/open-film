# ADR 009: GPLv3 derivative distribution with preserved Apache grants

Status: Accepted for the current derivative distribution, superseding
[ADR 007](007-license.md) without withdrawing its historical grants.
Date: 2026-10-18.

## Context and decision

The maintainer requested stronger reciprocal source obligations and selected
GPL-3.0 for distributions. AGPL-3.0 was also considered for modified network
services. The current decision is **GPL-3.0-only**: version 3, without an automatic
grant for future license versions. Commercial use remains allowed. Network use
alone does not trigger GPL source delivery; delivering covered browser code is
still distribution. The comparison and source requirements are in
[licensing](../licensing.md).

OpenFilm already contains contributions from multiple authors under Apache-2.0;
no copyright assignment or unanimous relicensing consent is asserted. Apache
section 4 permits different terms for modifications and a derivative work as a
whole, subject to preservation of its notices and license. Accordingly:

- The current modified work as a whole and new authorized OpenFilm contributions
  use GPL-3.0-only.
- Previously published material and preexisting portions retain their Apache
  grants. The exact original license is preserved in `LICENSES/Apache-2.0.txt`
  and the original attribution is retained verbatim in `NOTICE`.
- Modified Apache source files carry change notices. Third-party dependencies,
  fonts, external programs and fixture CC0 dedications retain their terms.
- New film-look recipes use the selected current source license. Their numeric
  recipe version is unchanged because licensing does not change coefficients.

## Consequences

Covered binary distributions must provide Corresponding Source through a method
allowed by GPLv3, including actual changes and necessary build/install material.
A link to a different upstream revision is insufficient. Source manifests and
Rust/package metadata state the selected license consistently.

This decision does not license user-imported media or ordinary rendered films,
and it does not automatically cover an independent HTTP provider. It is not a
claim that an installer has satisfied its separate runtime/codec/font obligations.

AGPL would add the modified program's remote-user source offer obligation. If
that scope is selected later, update the authoritative license, package metadata,
contribution terms, provenance and tests together, and establish an exact deployed
source offer for any remotely accessible modified service.
