# Licensing and distribution

The repository's [LICENSE](../LICENSE) is authoritative. This guide explains
the GPL-3.0-only and AGPL-3.0-only options; it does not itself change the license
or replace the license text. `-only` selects version 3 rather than automatically
granting permission under later versions.

The selected current derivative distribution is **GPL-3.0-only**, recorded in
[ADR 009](adr/009-copyleft-license.md). AGPL was considered for future modified
network services; it is not an additional current license or a dual-license offer.
The original Apache text is preserved in [LICENSES/Apache-2.0.txt](../LICENSES/Apache-2.0.txt).

## Choosing the copyleft scope

| Option        | Distribution                                                                                        | Running a modified version as a network service                                                                                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GPL-3.0-only  | Distribution of covered executables requires compliance with GPLv3, including Corresponding Source. | Operating a server alone does not create a source offer requirement for remote users. Delivering covered browser code to them is distribution.                                                                 |
| AGPL-3.0-only | Distribution carries the corresponding AGPLv3 source obligations.                                   | Section 13 additionally requires a modified version to prominently offer users interacting with it remotely an opportunity to receive its Corresponding Source, at no charge, through ordinary network access. |

Both options allow commercial use, modification and redistribution under their
terms. Private local use alone does not require public publication of changes.
AGPL adds a source offer for the modified program's remote users; it does not
require every private modification to be published to the world.

## Apache history and the current derivative work

OpenFilm has preexisting Apache-2.0 material contributed by multiple authors.
Apache-2.0 section 4 permits different terms for modifications and a derivative
work as a whole, subject to its preservation requirements. Its material can be
included in a GPLv3 or AGPLv3 derivative while retaining applicable Apache terms.

A transition must preserve the complete Apache-2.0 license, original copyright
and attribution notices, and the original [NOTICE](../NOTICE), clearly identifying
the historical material. Modified Apache files must carry prominent change
notices. New contributions and the derivative distribution as a whole can use
the selected copyleft license without claiming that every contributor assigned
copyright or approved exclusive relicensing of their original contribution.

Previously granted Apache-2.0 rights remain available for the material covered
by those grants. A new distribution license cannot revoke them or retroactively
make every historical revision copyleft. Historical decisions and references
should identify their original context and link to the current licensing policy.

## Providing Corresponding Source

When distributing covered binaries, use a source delivery method permitted by
the applicable license. Provide the source for the actual distributed version,
including modifications, required interface definitions, and scripts needed to
build and install it. Include the applicable dependency information, lockfiles,
license notices and any required Installation Information. The license's
exclusions for System Libraries and certain general tools still apply.

For an AGPL modified service, make the source offer prominent in the remote
interface and keep the download accessible at no charge. A reproducible archive
or accessible repository revision must contain the exact deployed changes and
the necessary build and installation material. A link to an upstream project's
current main branch is insufficient when it omits those changes or identifies a
different version. Merely running an unmodified tool locally does not create a
remote service deployment.

## Media, dependencies and separate services

Importing a photograph, video, soundtrack or transcript into OpenFilm does not
automatically license that material under GPL or AGPL. Ordinary rendered output
is not automatically covered either; included covered program material can have
its own obligations. Users retain responsibility for rights in their media.
Procedural fixture media retains its stated CC0 dedication, independently of
the generator's source license.

[Third-party components](third-party.md), fonts, model weights and external
programs retain their own licenses and notices. The OpenFilm project license
does not replace them. Review the actual components and binary configuration
when preparing a distributable package.

Calling an independent provider over HTTP does not automatically put that
provider, its model or its service under OpenFilm's copyleft license. Whether
components form one covered combined work depends on their actual relationship;
a network request alone does not establish that relationship.
