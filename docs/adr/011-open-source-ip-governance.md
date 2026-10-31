# ADR 011: Apache-2.0 governance, brand integrity, and commercial options

Status: Proposed for maintainer review.
Date: 2026-10-31.

## Context

ADR 007 originally selected Apache-2.0. ADR 009 recorded a historical
GPL-3.0-only distribution; ADR 010 restored Apache-2.0 for the current
authorized first-party distribution while retaining historical grants.
OpenFilm's maintainer wants a credible open-source project with an option
to offer commercial products and avoid confusion about official releases.

Apache-2.0 permits commercial forks and proprietary derivatives. Adding a
"non-commercial" or "no competing products" restriction would conflict with
the project's selected license and with the Open Source Definition.

## Decision

1. Keep the original root LICENSE, archived LICENSES texts, NOTICE, and
   recorded historical grants unchanged.
2. Publish separate TRADEMARKS.md, COMMERCIAL.md, GOVERNANCE.md and DCO.md,
   without presenting these documents as amendments to Apache-2.0.
3. Record provenance checks and post-adoption contributor sign-offs in
   contribution and PR guidance; copyright is not assigned by DCO.
4. Identify governance-sensitive paths via CODEOWNERS and add a fast CI
   check for Apache license integrity, metadata and essential documentation.
5. Keep official software identity separate from permission to fork code.
   Do not claim trademark registration or exclusive rights before clearance.
6. Defer any CLA, additional commercial relicensing, or licensing change
   until there is a documented contributor-rights assessment and review.

## Consequences

Maintainers have auditable source/license guardrails and a clearer path to
commercial support, managed services and optional products. Other parties
still retain all Apache-2.0 and applicable historical license permissions.
The new policy does **not** prevent lawful competitive forks, require
downstream source publication, or make third-party contributions proprietary.
Trademark enforcement requires actual rights under applicable law.

## Follow-up verification

- Validate the Apache license remains byte-identical to its archived copy.
- Run the license-governance CI check and the existing doc/format checks.
- Configure branch protection/rulesets separately; CODEOWNERS is advisory
  unless required review is enabled.
- Perform clearance of the name and logo in intended commercial markets.
- Review third-party packaging, especially FFmpeg binaries, before shipping.
- Seek legal review before introducing CLAs, paid-license contracts, or
  jurisdiction-specific trademark assertions.
