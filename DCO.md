# Developer Certificate of Origin (DCO) sign-off

OpenFilm uses the [Developer Certificate of Origin, version 1.1](https://developercertificate.org/)
to document the provenance of new
contributions. Contributors first submitting work after adoption of this
policy must sign off each new commit they contribute.

A sign-off means the contributor certifies, under DCO 1.1, that they have the
right to submit the work under its indicated open-source license. It does
not transfer copyright to OpenFilm, authorize reuse of confidential or
unlicensed third-party material, or grant exclusive dual-licensing rights.

Create signed-off commits with:

    git commit -s -m "Describe the change"

The footer should follow this form, with the contributor's own identity
and an email address they are authorized to use:

    Signed-off-by: Full Name <email@example.com>

Commits must carry the contributor's own attestation. Maintainers may request
that missing sign-offs be corrected before accepting a new PR. Do not add
someone else's sign-off without their authorization. Historical commits
predating adoption are not retroactively invalidated.

Check employer authorization, external snippets, generated code, model assets,
fonts and media before submitting. Include relevant upstream copyrights,
licenses and attribution. A DCO sign-off does not replace legal review of
material whose rights are unclear.

## Enforcement in incoming pull requests

Once the policy workflow is merged into the default branch, incoming PRs
must satisfy the **Contributor provenance / DCO sign-off** job before merge.
The job checks each PR commit and any Co-authored-by trailers for matching
Signed-off-by entries. It uses the GitHub API, without executing PR code.
The policy does not retroactively invalidate commits already merged upstream.
Open PRs should complete their sign-offs before a future merge.

A failed sign-off must be corrected by the actual contributor. For a local
commit that has not been shared, run:

    git commit --amend --no-edit -s

For a published branch, coordinate history rewriting with collaborators;
do not forge another person's signature. Sign-offs are self-attestations,
not a legal identity verification or copyright assignment. See
[repository permissions](docs/governance/repository-permissions.md).
