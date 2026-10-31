# OpenFilm repository access and contribution integrity

Status: **implementation guide**; GitHub repository settings require a separate administrator action.
Snapshot checked: **2026-10-31**. The public repository's main branch was unprotected
and no repository rulesets were returned. Documentation and CODEOWNERS do not
change either setting. Recheck after configuration.

## Boundaries

Apache-2.0 governs licensed source code and permits lawful commercial forks.
GitHub access controls govern which people and workflows can alter the
**official upstream**. These controls cannot revoke earlier Apache or GPL
grants, prevent competitors using licensed code, or assert trademark priority.
See the [licensing guide](../licensing.md) and the
[commercial policy](https://github.com/bynanci/open-film/blob/main/COMMERCIAL.md).

## Access roles (target state)

| Role | GitHub access | Duties |
| --- | --- | --- |
| Repository owner (@bynanci) | Admin; use strong MFA/passkeys | Policy, emergency recovery, official release approval |
| Additional trusted maintainer (if appointed) | Write or Maintain; least privilege | Review code and sensitive changes, validate releases |
| Community contributor | Fork and open PR; no upstream write | Tests, changes, DCO self-attestation, source provenance |
| Issue triager | Triage only | Organize reports without changing code or release settings |
| CI on untrusted PRs | GITHUB_TOKEN read-only; no secrets | Build/test/report, no deployment or mutation |
| Official release workflow | Narrow, event-scoped publish rights | Release reviewed artifacts only after required gates |

Do not make all contributors collaborators with Write access. Review collaborator
permissions quarterly and immediately after role changes. Require MFA, avoid
personal access tokens where the built-in GitHub token or scoped app token works,
and never put cloud credentials in PR checks or generated artifacts.

## Default branch ruleset setup (manual GitHub Settings action)

Navigate to **Settings > Rules > Rulesets > New branch ruleset** and target
only **main**. Begin with an **Evaluate** or staged rollout if available; use
**Active** once verification succeeds. Keep a recovery administrator and confirm
the rule does not strand the sole maintainer.

1. Require pull requests for main. Disable branch deletion and force pushes.
2. Require current CI results (start with the aggregate
   **typescript-and-media**, **docs-site**, **native-shell** and
   **render-qa-complete**, after confirming the exact observed GitHub check
   names and their triggering scope). Do not add a check that is conditional or
   never runs on ordinary PRs. The additional **DCO sign-off** check must first
   run successfully on a post-activation PR before it becomes required.
3. Require resolved conversations and dismiss stale approvals on new changes
   when the team has a second independent reviewer.
4. Enable **Require review from Code Owners** and at least one independent
   approval **only after** another trusted person with review permission is
   available. A sole CODEOWNER cannot approve their own PR. Requiring one
   approval with only @bynanci would block ordinary maintainer changes.
5. Limit bypass permissions. Do not remove the sole administrator's recovery
   ability without a tested break-glass path and a second maintainer.
6. After saving, test with a harmless PR and an intentionally failing check.
   Confirm a direct push and force push are denied before treating the control
   as active. Record the settings and their verification date.

GitHub required checks apply to specific status names. Avoid accidentally
requiring matrix jobs, manual-only release tasks, or path-filtered workflows
that may never run. Reassess if merge queue is enabled, since those checks need
the merge_group event.

## Contributions: DCO, not copyright assignment

After this policy is merged into the default branch, the
**Contributor provenance / DCO sign-off** workflow evaluates incoming PRs
against [DCO.md](https://github.com/bynanci/open-film/blob/main/DCO.md).
It reads GitHub's PR commit metadata using a read-only token and executes
only the default branch's trusted parser. It does not check out or run
untrusted PR code. PR authors and declared co-authors must each add their own
final-block Signed-off-by trailer matching their commit metadata email.
Commits already merged before activation are not invalidated.

A sign-off is a **self-declaration**; GitHub email consistency is not proof
of legal identity, employer authorization, ownership, or code originality.
Require separate provenance review for copied third-party code, licensed
media, fonts, AI-generated material, confidential datasets and model weights.
Do not add someone else's sign-off or automatically treat DCO as a CLA.
Automated bot contributions require their own reviewed exception policy;
this initial checker has no blanket bot bypass.

The trusted workflow uses pull_request_target solely to inspect GitHub API
metadata. GitHub's security guidance warns against running untrusted PR code
under this trigger. Never add PR checkout, package installation, PR-authored
shell commands, secrets or writable tokens to that workflow.

## Official builds and releases

Keep release credentials separate from untrusted PR CI. Prefer an approval
gated environment for signing/publishing, release artifacts built from an exact
tag and commit, provenance receipts, SHA-256 digests, SBOM and source/third-party
license notices. Check actual FFmpeg, codec, model and font rights for every
distributable artifact. An installer or model mirror is not licensed merely
because OpenFilm's own code uses Apache-2.0.

## Governance-sensitive changes

The [CODEOWNERS policy](https://github.com/bynanci/open-film/blob/main/.github/CODEOWNERS)
covers license history, policies, CI, DCO scripts and documentation.
CODEOWNERS names reviewers but only a GitHub ruleset makes a review required.
Do not allow a PR to modify its own trusted provenance gate and bypass review.
A change to licensing or contribution terms requires separate review and a
documented decision. A future CLA or commercial dual-license needs a
contributor-rights audit and legally effective consent; copying Concat's
copyright-assignment wording would not establish OpenFilm's chain of title.

## Activation acceptance criteria

- [ ] GitHub ruleset protecting main is saved and independently verified.
- [ ] Existing CI checks and the DCO job are observed on a post-merge PR.
- [ ] An unsigned new PR fails the DCO check; a genuinely signed-off PR passes.
- [ ] A malicious body-only "Signed-off-by" string does not bypass the check.
- [ ] CODEOWNERS coverage and reviewer configuration do not deadlock the maintainer.
- [ ] Official release rights, secrets and publish paths are audited.
- [ ] Repository role assignments and emergency recovery procedure are documented.

This is operational policy and technical guidance, not legal advice or a new
license condition.
