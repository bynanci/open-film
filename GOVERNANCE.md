# OpenFilm project governance

OpenFilm is developed in public. The repository maintainer (@bynanci)
coordinates upstream merges, project direction, release artifacts, and
official project communications. Contributors retain the rights they hold
in their own work; maintainer access does not establish copyright ownership
over every contribution.

## Source and release integrity

- The root LICENSE and historical license records must be preserved. A policy
  document cannot amend the standard Apache-2.0 license text.
- Changes affecting license selection, copyright/attribution records, branding,
  commercial policy, or contributor terms require explicit maintainer review.
- Dependency, font, model, codec, media, and copied-source rights must be
  checked independently before being bundled or redistributed.
- Source edits must retain applicable notices and identify modifications
  as required by the governing licenses.
- Official releases must be traceable to reviewed commits and must not imply
  that unresolved manual or cross-platform release checks have passed.
- Official branding and commercial agreements are separate from Apache-2.0
  source-code permissions; see TRADEMARKS.md and COMMERCIAL.md.

## Contribution review

For new PRs after adoption of this policy, contributors must provide the
provenance attestation described in [DCO.md](DCO.md). Reviewers check that
contributors are authorized to submit employer-owned, third-party, and
AI-assisted material, and that applicable notices are retained.

The [.github/CODEOWNERS](.github/CODEOWNERS) file identifies sensitive paths
for review. **CODEOWNERS alone does not enforce merge protection**: repository
administrators must separately configure branch rules requiring reviews,
relevant CI checks, and appropriate restrictions. Maintainers should
periodically audit these settings.

## Disputes and changes

Raise routine governance questions through an issue. Do not disclose
security vulnerabilities publicly; follow [SECURITY.md](SECURITY.md).
Policy changes should receive their own PR and architecture decision record.
Any proposed license migration requires a documented rights assessment and
cannot retroactively remove existing, valid license grants.

Governance policies describe intended project practice. Their effectiveness
depends on actual permissions, applicable law, maintainer review, and
repository settings; they do not promise absolute control over forks.
