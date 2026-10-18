# ADR 007: Apache-2.0 for code and CC0 for generated media

Status: Original permissive-license decision, temporarily superseded by
[ADR 009](009-copyleft-license.md). Apache-2.0 is restored for the current
first-party distribution by [ADR 010](010-apache-license-restoration.md).
Previously granted rights remain available.

## Context

The project is intended for community extensions, commercial use, redistribution,
and forks. A permissive license with an explicit patent grant supports these goals.

## Decision

License project code under Apache License 2.0. Compared with MIT, Apache-2.0 makes
its patent grant and related termination terms explicit. Dedicate the procedurally
generated sample outputs to the public domain under CC0 1.0; their generator stays
under the code license. Preserve third-party dependency licenses.

## Consequences

Redistribution must follow the actual LICENSE and any applicable notice/attribution
requirements. This ADR explains the choice and does not replace the license text
or grant rights to private/user-imported media. New fixture media needs documented
redistribution rights; no personal media is committed.

_Modified by OpenFilm contributors on 2026-10-18 to record the license decision history. See LICENSE and NOTICE for current terms._
