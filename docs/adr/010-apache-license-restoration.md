# ADR 010: Restore Apache-2.0 for authorized first-party work

Status: Accepted, superseding [ADR 009](009-copyleft-license.md) for the current
first-party distribution and restoring the policy in [ADR 007](007-license.md).
Date: 2026-10-18.

## Context

After selecting GPL-3.0-only and considering AGPL-3.0, the maintainer explicitly
requested a return to Apache-2.0 to allow greater freedom for downstream use.
This is a license-policy change, not a reason to remove existing functionality,
security checks or third-party attribution.

The repository already preserves the original Apache-2.0 text and attribution.
The provenance review for this transition found no imported third-party GPL-only
source in the reviewed first-party changes that would require retaining GPL-only
terms for the current OpenFilm distribution. Upstream projects referenced for
workflow and film-look concepts were independently implemented; external
runtimes, libraries, fonts and models retain their own terms. Git author names
do not establish copyright assignments, and this decision does not assert that
all contributors assigned their rights.

## Decision

- Offer the authorized OpenFilm first-party work and new contributions under
  Apache-2.0. Restore the exact original Apache license as the root `LICENSE`.
- Preserve the original attribution in `NOTICE`, the historical Apache text in
  `LICENSES/Apache-2.0.txt` and the earlier GPL text in
  `LICENSES/GPL-3.0-only.txt`. Keep ADR 009 as a superseded historical record.
- Preserve previously granted Apache-2.0 and GPL-3.0-only rights for the material
  covered by those grants. Do not claim that this decision retroactively changes
  historical revisions or revokes permissions already granted.
- Align package/Rust metadata, first-party file notices, contribution terms,
  original recipe provenance and current documentation with Apache-2.0. Retain
  notices identifying modified files. The recipe's numeric version and
  coefficients do not change because its licensing changes.
- Retain third-party notices and actual upstream license terms. Do not relabel
  external code, fonts, models or generated CC0 media as OpenFilm-owned Apache
  work.

## Consequences

Downstream users can use, modify and redistribute the current first-party code
commercially, including in proprietary derivatives, subject to Apache's license
and notice conditions. Apache supplies an express contributor patent grant with
its stated limits; it does not grant general trademark rights or warranties.
There is no general requirement to publish modifications merely because a
program is distributed or operated as a network service.

The prior GPL source-delivery conditions remain relevant to use under those
historical grants. AGPL's additional modified-network-program source offer was
considered but was never adopted. The current Apache decision does not impose
that condition.

FFmpeg/FFprobe remain external system prerequisites. Existing photo motion and
H.264 encoding may use GPL components in an installed FFmpeg build; restoring
OpenFilm's license does not change that binary's terms. An installer bundling
FFmpeg, resvg, fonts or other components still needs their applicable notices and
distribution compliance. Imported private media and ordinary rendered films are
not automatically relicensed by this decision.

## Validation

Check the root license against the preserved Apache bytes. Verify all first-party
package/Rust declarations and recipe provenance agree, required notices and
fixture CC0 terms remain intact, and current documentation distinguishes current
policy from historical decisions and actual third-party GPL references. This
license change does not claim workstation, Resolve or media-quality verification.
