# ADR 009: GPLv3 derivative distribution with preserved Apache grants

Status: Historical decision, superseded by
[ADR 010](010-apache-license-restoration.md). This record describes the GPL
terms previously offered; it does not declare the current distribution license.
Previously granted Apache-2.0 and GPL-3.0-only rights remain available for the
material covered by those grants.
Date: 2026-10-18.

## Context and decision

The maintainer requested stronger reciprocal source obligations and selected
GPL-3.0 for distributions. AGPL-3.0 was also considered for modified network
services. The decision at that time was **GPL-3.0-only**: version 3, without an automatic
grant for future license versions. Commercial use remains allowed. Network use
alone does not trigger GPL source delivery; delivering covered browser code is
still distribution. The [licensing guide](../licensing.md) now explains the
restoration to Apache-2.0 and preservation of earlier grants.

OpenFilm already contains contributions from multiple authors under Apache-2.0;
no copyright assignment or unanimous relicensing consent is asserted. Apache
section 4 permits different terms for modifications and a derivative work as a
whole, subject to preservation of its notices and license. Accordingly:

- The modified work as a whole and new authorized OpenFilm contributions in
  that distribution were offered under GPL-3.0-only.
- Previously published material and preexisting portions retain their Apache
  grants. The exact original license is preserved in `LICENSES/Apache-2.0.txt`
  and the original attribution is retained verbatim in `NOTICE`.
- Modified Apache source files carry change notices. Third-party dependencies,
  fonts, external programs and fixture CC0 dedications retain their terms.
- The new film-look recipes used the selected GPL source license. Their numeric
  recipe version was unchanged because licensing does not change coefficients.

## Consequences

Covered binary distributions must provide Corresponding Source through a method
allowed by GPLv3, including actual changes and necessary build/install material.
A link to a different upstream revision is insufficient. Source manifests and
Rust/package metadata stated that distribution's selected license consistently.
These requirements describe distributions under GPLv3; they do not impose GPL
terms on newly authorized Apache-2.0 distributions.

This decision does not license user-imported media or ordinary rendered films,
and it does not automatically cover an independent HTTP provider. It is not a
claim that an installer has satisfied its separate runtime/codec/font obligations.

AGPL was considered because it would add the modified program's remote-user
source offer obligation. It was not adopted. The later Apache-2.0 restoration is
recorded separately in ADR 010; it does not withdraw grants already made under
this decision.
