# Main merge controls: owner review packet — issue 146

Status: **proposed, not applied**. No rules, settings, secrets, roles, trust or
publication permissions were changed. Owner approval must name the exact
reviewed payload hash, no-bypass/recovery scope and validation plan before an
administrator executes any write below. This is distinct from source-code
review, AI review, DCO or general authorization to solve issues.

## Read-only inventory observed 2026-11-11

Queries completed at approximately 09:06–09:07 UTC against `bynanci/open-film`.
The preparation checkout is `08e38b6a63a0b0fbcfd3a073c8bfa5dcc8c08224`.
The execution ledger retains raw responses, query exit statuses and hashes in
`platform-gates-evidence/`; [the inventory](platform-gates-inventory.json)
pins source files and that capture. Refresh before activation, because this
snapshot does not establish later state.

| Endpoint / observation                                                             | Actual result                                                               | Consequence                                                                                          |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET repos/bynanci/open-film/branches/main`                                        | SHA above, `protected: false`                                               | No main protection claimed                                                                           |
| `GET .../rulesets` and `GET .../rules/branches/main`                               | Both empty arrays                                                           | No returned repository/effective main rules                                                          |
| `GET .../branches/main/protection`                                                 | HTTP 403, resource inaccessible                                             | Restricted details unknown; no inferred settings                                                     |
| `GET .../collaborators`                                                            | Only `bynanci`, Admin/Maintain/Write                                        | No second independent reviewer observed                                                              |
| `GET .../actions/workflows`                                                        | Verify, Render QA, Windows media recovery and Contributor provenance active | Workflow names are not check contexts                                                                |
| `GET .../commits/<main-sha>/check-runs?per_page=100`                               | Exact contexts below, GitHub Actions app ID 15368                           | Historical successful checks only                                                                    |
| `GET .../commits/5daa77eeb347d22690a7020b5e37b0544914e17b/check-runs?per_page=100` | `DCO sign-off` and Render QA present/successful on PR 147 head              | DCO has an observed real PR-head check; PR 147 full Verify was still incomplete                      |
| `GET .../dependabot/alerts?per_page=1`                                             | HTTP 403; API message says alerts disabled                                  | Retain that response; owner must attest actual alerting configuration/access, no enabled-alert claim |
| `GET .../actions/secrets?per_page=1`                                               | HTTP 403, resource inaccessible                                             | Signing secret metadata unknown; no values requested                                                 |
| `GET .../environments`                                                             | Only `github-pages` returned                                                | No signing/release approval environment observed                                                     |

Exact required contexts in the proposed payload, all pinned to observed GitHub
Actions integration ID `15368`:

| Workflow file / name                                  | Required check context | Source scope                                                                       |
| ----------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------- |
| `ci.yml` / Verify                                     | `typescript-and-media` | Aggregate includes fast, real media, all browser shards and docs                   |
| `ci.yml` / Verify                                     | `docs-site`            | Actual docs build                                                                  |
| `ci.yml` / Verify                                     | `native-shell`         | Linux native build/tests, not Windows/macOS installer acceptance                   |
| `render-qa.yml` / Render QA                           | `render-qa-complete`   | Validates actual Linux x64, Windows x64, Darwin ARM64 receipts                     |
| `windows-media-recovery.yml` / Windows media recovery | `windows-ffmpeg9`      | Actual selected Windows recovery/media/browser workload                            |
| `contributor-provenance.yml` / Contributor provenance | `DCO sign-off`         | Trusted default-branch parser inspects PR metadata/head; no untrusted PR execution |

Do not use workflow names `Verify`/`Render QA` as required check names. Do not
require each matrix display name, manual-only installer/release jobs or the
path-filtered historical Windows configuration. Manual native source admission
is still an independent release gate; this payload does not silently invent a
new ordinary-PR status for it.

## Reviewable source changes and activation prerequisites

This packet changes Verify checkouts to the explicit PR source SHA (or push
SHA), disables persisted checkout credentials, and adds an actual `git HEAD`
comparison before each job's work. Render QA and Windows recovery gain the same
comparison. Its machine-readable log receipt says `verification: source-head`
and `mergeIntegrationVerified: false`. It fails on an absent/malformed SHA or
checkout mismatch. The guard also runs locally against real temporary Git
commits in `scripts/ci/tests/source-head.node.mjs`.

Windows recovery's PR path filter is removed. Every ordinary PR, including
documentation-only changes, now executes the real Windows workload; there is
no skip-as-success placeholder. This deliberately spends Windows CI capacity
to keep `windows-ffmpeg9` a reliable required context. No media assertion,
timeout or retry budget is weakened. Existing failure-aware artifact steps
remain, and a failed mandatory step still fails the job.

Exact source-head proof is different from testing GitHub's synthetic merge
commit. Previously Verify used checkout's default PR merge ref while several
reports declared the PR source SHA. The explicit checkout fixes that provenance
mismatch; it does not claim to test a synthetic merge. The proposed strict
required-check policy requires an up-to-date PR branch before merging. A base
advance therefore requires bringing base into the branch and rerunning on the
new real source head. If a future merge queue or synthetic integration proof is
wanted, add a separately named `merge_group`/integration check and test that
contract before enabling the queue; these workflows do not currently support it.

Before activation:

1. Independently review and merge these source changes using current authorized
   process. Never change `pull_request_target` to execute contributor source.
2. On a new harmless documentation-only PR, record the new head, all six exact
   contexts, app ID, checkout receipts, source SHA, run/attempt IDs and actual
   conclusions. Preserve logs/artifacts beyond seven-day CI retention. A pending,
   failed, skipped, cancelled or stale check is not a pass.
3. Confirm that the owner is still the sole administrator/maintainer and can use
   the Rules UI/API for recovery. Confirm GitHub plan/API support and the exact
   app identity. A 403 from this agent does not establish owner access.
4. Obtain the explicit owner disposition below. Do not activate while any
   required context is absent or a qualification is unresolved.

## Exact proposed policy and recovery tradeoff

Payload: [main-ruleset-proposal.json](main-ruleset-proposal.json).
Rollback: [main-ruleset-rollback.json](main-ruleset-rollback.json).
Target is only `refs/heads/main`; release branches/tags are outside this payload.
It requires PRs, resolved review threads, all six checks, an up-to-date branch,
and rejects deletion/force push for actors without bypass.

The default payload has `bypass_actors: []`. The owner/admin must use a PR
and satisfy the same checks, branch currency and conversation rules as other
writers. Normal direct push, force push and branch deletion are denied even to
the sole maintainer. No app/team/role bypass is granted. Repository administration
permissions still allow the owner to edit the ruleset; branch enforcement does
not remove that administrative recovery ability. Confirm that access before
activation and preserve the scoped disable/restore procedure below.

An Admin `always` bypass is a weaker alternative because the only current writer
would retain accidental direct-push and check-bypass capability. It is not in
this proposal; adding any bypass requires a separately reviewed exact payload
and owner decision. Do not silently add one after an enforcement failure.

The payload dismisses stale reviews but requires **zero** approvals, no required
CODEOWNER review and no last-pusher approval. A sole maintainer cannot provide
their own independent approval. No human approval enforcement is claimed in
this stage. Enabling one approval/CODEOWNER/last-pusher restriction requires a
named second qualified reviewer, proof they can review these paths, an updated
concrete payload and separate owner approval. AI review and DCO are not substitutes.

Suggested exact owner disposition (currently **PENDING**, not signed):

> I approve creation of the main-only ruleset from payload SHA-256 [REAL HASH],
> the six check contexts/app ID, strict up-to-date branch policy and zero required
> approvals while no second reviewer is appointed. No actor bypass is granted.
> I retain repository-admin ability to edit this rule and approve rollback SHA-256
> [REAL HASH] for disabling only this newly created rule if the agreed safe
> validation fails, followed by audited restoration after the cause is fixed. Authorized administrator: [NAME]. Test actor/PR and permitted
> control cases: [ACTOR/PR/SCOPE]. Approval timestamp/reference: [REAL VALUE].

## Administrator execution after the disposition

The following are reviewable commands, **not executed by this session**. Run
from the reviewed checkout. `OPENFILM_APPROVAL` must refer to the retained owner
decision covering the actual file hashes; setting a variable alone is not approval.
Save a fresh baseline before any mutation; abort if rules have changed since
review rather than overwriting another rule. The endpoint must remain this repo.

```sh
: "${OPENFILM_APPROVAL:?retained concrete owner decision required}"
: "${OPENFILM_ADMIN_EVIDENCE:?new absolute admin evidence directory required}"
mkdir "$OPENFILM_ADMIN_EVIDENCE"
gh api repos/bynanci/open-film/rulesets > "$OPENFILM_ADMIN_EVIDENCE/before-rulesets.json"
gh api repos/bynanci/open-film/rules/branches/main > "$OPENFILM_ADMIN_EVIDENCE/before-effective-rules.json"
gh api repos/bynanci/open-film/branches/main > "$OPENFILM_ADMIN_EVIDENCE/before-main.json"
sha256sum docs/governance/main-ruleset-proposal.json docs/governance/main-ruleset-rollback.json > "$OPENFILM_ADMIN_EVIDENCE/payload-sha256.txt"
# Review baseline and match payload hashes to the owner decision before this write.
gh api --method POST repos/bynanci/open-film/rulesets --input docs/governance/main-ruleset-proposal.json > "$OPENFILM_ADMIN_EVIDENCE/created-rule.json"
OPENFILM_RULE_ID=$(jq -er '.id | select(type == "number" and . > 0)' "$OPENFILM_ADMIN_EVIDENCE/created-rule.json")
gh api "repos/bynanci/open-film/rulesets/$OPENFILM_RULE_ID" > "$OPENFILM_ADMIN_EVIDENCE/after-rule.json"
gh api repos/bynanci/open-film/rules/branches/main > "$OPENFILM_ADMIN_EVIDENCE/after-effective-rules.json"
gh api repos/bynanci/open-film/branches/main > "$OPENFILM_ADMIN_EVIDENCE/after-main.json"
```

Require actual server acceptance and inspect the returned name, target,
conditions, enforcement, bypass actors and every rule parameter against the
approved payload. Persist the new rule ID. Do not infer API schema acceptance
from local JSON validation. A failed POST is a failed attempt, not authorization
to loosen the policy or change unrelated classic protection. A new nonempty
baseline requires a revised proposal and rollback snapshot.

## Safe control validation after approved activation

Create a disposable test branch/PR only under the owner-approved scope, preserve
raw command/API responses and commit identities, and never send an actual force
update/deletion request to production `main` as a test. Local `git push --dry-run`
does not execute server enforcement and is not rejection proof.

| Case                                 | Expected result / how to avoid damaging main                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh signed harmless PR             | All six actual checks run on the current source head; merge is permitted after required conversation resolution and up-to-date branch; record actual approved merge only if owner authorizes it                                                                                                                                                                       |
| Missing DCO, then genuine correction | Trusted DCO check fails and blocks non-bypass actor merge, then a new genuinely signed commit passes; never fabricate another person's trailer                                                                                                                                                                                                                        |
| Deliberate real test failure         | Change a disposable test fixture/assertion in the approved test PR; real check fails; non-bypass actor merge attempt must be rejected; restore with new signed commit and all fresh checks                                                                                                                                                                            |
| New head / stale checks              | Push a new commit to the approved PR; old check results do not approve the new head; record head/run linkage and merge denial while new checks are pending                                                                                                                                                                                                            |
| Base advance                         | Advance main only through an independently approved harmless PR; test PR must become behind and require update/rerun; do not bypass to manufacture the condition                                                                                                                                                                                                      |
| Open review conversation             | Named reviewer opens a real test thread, non-bypass actor merge is blocked until resolution; no approval-count enforcement is expected                                                                                                                                                                                                                                |
| Direct push, including admin         | Owner is already a non-bypass writer. On a disposable branch protected by a separately approved equivalent temporary rule, submit a harmless commit and retain actual rejected push response. This tests equivalent enforcement; production-main direct-push rejection remains unobserved unless owner authorizes an actual harmless request with backup and recovery |
| Force push / deletion                | Verify returned production rule plus actual rejection against that separately approved disposable protected branch. No destructive request to main; record production empirical case as unobserved                                                                                                                                                                    |
| Admin recovery                       | Owner proves UI/API access and can read the returned rule. Actual disabling/restoration requires scoped recovery authorization; record administrative edits separately from normal Git operations                                                                                                                                                                     |
| Stale human approval                 | Dismissal setting is inspectable now; actual dismissal/required-approval behavior remains unobserved until a second reviewer exists and supplies a real approval                                                                                                                                                                                                      |

Do not report issue 146 applied/verified until owner-approved actual control
cases and remaining explicit qualifications are reviewed. With the current
sole-admin configuration, full independent-review and actual direct-push rejection proof
cannot be manufactured by this session.

## Rollback and emergency procedure

Preferred response to validation deadlock: stop merges/publication, preserve
failed responses and the created rule ID, and have the owner/admin disable
only the newly created ruleset using the preapproved rollback payload. This
returns this new rule's enforcement to disabled while preserving its history.
It does not claim to restore any separate, unreadable classic protection.

```sh
: "${OPENFILM_APPROVAL:?rollback must be within retained owner decision}"
: "${OPENFILM_RULE_ID:?ID from retained creation response required}"
gh api "repos/bynanci/open-film/rulesets/$OPENFILM_RULE_ID" > "$OPENFILM_ADMIN_EVIDENCE/pre-rollback-rule.json"
# Match rule ID/name/target to the newly created rule before the approved write.
gh api --method PUT "repos/bynanci/open-film/rulesets/$OPENFILM_RULE_ID" --input docs/governance/main-ruleset-rollback.json > "$OPENFILM_ADMIN_EVIDENCE/rollback-response.json"
gh api "repos/bynanci/open-film/rulesets/$OPENFILM_RULE_ID" > "$OPENFILM_ADMIN_EVIDENCE/post-rollback-rule.json"
gh api repos/bynanci/open-film/rules/branches/main > "$OPENFILM_ADMIN_EVIDENCE/post-rollback-effective-rules.json"
```

If someone changed this rule after creation, do not apply the stale rollback
blindly: owner reviews a new snapshot/disposition. If API access is unavailable,
the owner uses Settings → Rules → Rulesets → the recorded ID/name → Disabled,
retaining screenshots and fresh read-only exports. Do not delete unknown rules,
reset trust, rotate secrets or force-rewrite main to repair a policy deadlock.
After fixing the cause, rechecking names/events and obtaining the new disposition
when payload/scope changes, restore this exact approved active policy with a PUT
to the same recorded rule ID using `main-ruleset-proposal.json`; retain the response
and fresh effective-rule read. Run the safe controls again before claiming restored
enforcement. No emergency direct push is authorized by this procedure; an urgent
source mutation needs its own concrete owner disposition and before/after SHA.

Approved restoration command (after those conditions, not executed here):

```sh
gh api --method PUT "repos/bynanci/open-film/rulesets/$OPENFILM_RULE_ID" --input docs/governance/main-ruleset-proposal.json > "$OPENFILM_ADMIN_EVIDENCE/restored-rule.json"
gh api repos/bynanci/open-film/rules/branches/main > "$OPENFILM_ADMIN_EVIDENCE/restored-effective-rules.json"
```

## Release and alerting attestation (still external)

The owner must separately name the alerting administrator, enabled alert sources,
notification recipient/response owner and review date; signing/notarization
operator; credential store/environment and permitted refs/events; and release
approver/publisher. Record role names and scopes only, never secret values.
No signing/release approval environment is currently evidenced by the inventory.
Configuring one, issuing certificates or granting a publisher is a separate
concrete owner-approved change, not implied by this main ruleset.

Publication remains blocked until the release owner explicitly accepts a full
source SHA, immutable final asset hashes, runtime/native attribution and any
platform-specific claim evidence plus exceptions/scope/expiry. Apply the
[release gates](../validation-release-gates.md) and platform handoff; source-only
approval never approves native installers. Re-audit on changed workflow/job name,
trigger/path filter, base/head model, app integration, merge-queue setting,
reviewer/role roster, release target or emergency bypass. Retain actual rule IDs,
decisions and evidence beyond ephemeral CI retention.
