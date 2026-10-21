# Licensing and distribution

OpenFilm's current first-party code is offered under **Apache-2.0**. The
repository's [LICENSE](https://github.com/bynanci/open-film/blob/main/LICENSE) is authoritative; this guide explains the
policy and does not replace the license text. The restoration is recorded in
[ADR 010](adr/010-apache-license-restoration.md).

## Using and distributing OpenFilm

Apache-2.0 permits commercial use, modification and redistribution, including
proprietary derivatives, subject to its terms. It does not require publishing
modifications or providing source solely because a program is distributed or
operated as a network service.

When redistributing covered material:

- Include a copy of the Apache-2.0 license.
- Retain the source notices required by section 4, including applicable
  copyright, patent, trademark and attribution notices.
- Mark modified files with prominent notices stating that they were changed.
- Preserve the applicable attribution notices from [NOTICE](https://github.com/bynanci/open-film/blob/main/NOTICE) in a
  readable form as required by section 4(d).
- Meet the actual licenses of any included third-party components separately.

The license contains an express contributor patent grant, subject to its stated
scope and termination conditions. It does not grant general trademark rights
and provides the work without warranties. Additional terms for a distributor's
own modifications must remain consistent with the applicable Apache conditions.
These are practical reminders; the complete license controls.

## License history and existing grants

[ADR 007](adr/007-license.md) selected Apache-2.0 originally.
[ADR 009](adr/009-copyleft-license.md) later offered an authorized modified
distribution under GPL-3.0-only while preserving the preexisting Apache grants.
The maintainer then explicitly requested a return to Apache-2.0 for greater
freedom of use. The current restoration applies to the authorized first-party
work; it does not claim a copyright assignment from all contributors or the
power to relicense someone else's code.

Previously granted Apache-2.0 rights remain available for the material covered
by those grants. Previously granted GPL-3.0-only rights likewise remain
available for the material covered by those grants. This restoration does not
revoke either grant, rewrite the license of a historical revision or remove the
conditions that apply when using material under its historical GPL terms.

The exact original Apache text is preserved in
[LICENSES/Apache-2.0.txt](https://github.com/bynanci/open-film/blob/main/LICENSES/Apache-2.0.txt), and the earlier GPL text is
retained in [LICENSES/GPL-3.0-only.txt](https://github.com/bynanci/open-film/blob/main/LICENSES/GPL-3.0-only.txt). That archive
records earlier terms; it does not designate GPL as the current license.
Original attribution remains in NOTICE. Future third-party contributions must
have permission compatible with the intended distribution; a repository-wide
license label cannot remove their actual upstream obligations.

## GPL and AGPL were considered

| Option        | Relevant source-sharing condition                                                                                                                                                                                                          | Current OpenFilm policy                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Apache-2.0    | No general requirement to provide source for distributed modifications or network services. License and notice conditions still apply.                                                                                                     | Selected for current first-party code.                           |
| GPL-3.0-only  | Distributing covered binaries requires compliance with GPLv3, including a permitted method of providing Corresponding Source. Operating a server alone does not trigger that requirement; delivering covered browser code is distribution. | Preserved historical grant, not the current distribution policy. |
| AGPL-3.0-only | In addition to distribution conditions, section 13 requires a modified program to prominently offer Corresponding Source to users interacting with it remotely through a network.                                                          | Considered but not adopted.                                      |

All three allow commercial use under their terms. Private local use alone does
not require publishing all changes to the world. A source-sharing condition
must be evaluated against the actual license and form of use, not the label
"open source" alone.

## Media, dependencies and separate services

Importing a photograph, video, soundtrack or transcript into OpenFilm does not
automatically license that material under the application's source license.
Ordinary rendered films are not automatically licensed under it either; users
retain responsibility for rights in their media and any other included
material. Procedural fixture media retains its stated CC0 dedication,
independently of the generator's Apache-2.0 source license.

[Third-party components](third-party.md), fonts, model weights and external
programs retain their own licenses and notices. In particular, restoring
OpenFilm's Apache-2.0 terms does not convert a GPL-enabled FFmpeg executable into
an LGPL-only executable, relicense resvg's MPL-2.0 code or permit redistribution
of operating-system fonts. FFmpeg/FFprobe are currently external system
prerequisites; future installers that bundle them must satisfy the terms of the
actual binary configuration and included components.

Calling a separate provider over HTTP does not relicense that provider, its
model or its service. Provider and model terms, media rights and privacy consent
remain separate from OpenFilm's application-source license.
