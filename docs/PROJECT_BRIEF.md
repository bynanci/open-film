# Project vision and scope

OpenFilm is an open-source, local-first media storytelling editor. It helps
people turn collections of photos, video and audio into a story, an editable
rough cut and a film they can finish or hand off to another editor.

This document explains the project's direction and design principles. It is not
a feature checklist or a release promise. The [roadmap](https://github.com/bynanci/open-film/blob/main/ROADMAP.md),
[task list](https://github.com/bynanci/open-film/blob/main/TASKS.md) and
[v1 readiness record](roadmap/v1-readiness.md) track implementation and validation.

## The problem we want to solve

A media collection often arrives before its story is clear. Sources have
different timestamps, repeated shots and incomplete context. Choosing what
matters, finding a useful order and fitting it into a watchable duration can take
more effort than the final edit.

OpenFilm connects those decisions to the edit. The intended workflow is to
organize media, inspect the available evidence, author a story, review a proposed
composition, refine it and export. A person can see why a suggestion was made
and keep, change or reject it.

The project's focus is media organization, story decisions and reviewable rough
cuts, with enough editing and output capability to make that workflow useful.
Interchange with established non-linear editors provides a path to further
finishing.

## Who it is for

OpenFilm began with a proposal-film workflow built from personal memories. The
same model should support travel, family archives, event recaps, portraits,
documentary material and other authored stories.

These are use cases, not a claim that every one has a dedicated template or
validated workflow today. Domain models stay general: a Story contains authored
beats, media choices and duration constraints. A relationship, wedding or travel
theme belongs in story content and templates, not in a separate editing engine.

## Product principles

### 1. Keep ownership with the user

Original media stays unchanged. Edits, analysis and generated derivatives have
their own records and provenance. Portable project data, relinking and media
collection help users keep their work usable as files and machines move.

### 2. Make the local workflow complete

The basic import, organization, story, editing, preview and export workflow runs
on the user's workstation without a cloud account. Optional providers extend
that workflow. Sending data to a remote provider requires clear disclosure and
explicit consent.

### 3. Treat suggestions as decisions to review

Analysis describes its sources and uncertainty. Missing context is not invented
as a fact about people, places or memories. A generated script is a draft; a
score is evidence to inspect. Proposals show their effect before acceptance and
respect manual choices, pins, locks and saved revisions.

### 4. Keep one authoritative edit

Story, graph, storyboard, pipeline and timeline are connected views and workflows
over shared domain models. A new feature reuses the existing Composition and
application services instead of creating another timeline or a competing save
path. Desktop, CLI and local API use the same commands and validation.

### 5. Make failures recoverable

Long-running work exposes progress, cancellation, failures and supported retry
paths. Uncertain responses and stale input must not silently overwrite accepted
work. Project versions, recovery records and source identity support reliable
editing throughout the application.

### 6. Keep formats and boundaries explicit

Versioned project and interchange formats support inspection and future
evolution. Export reports distinguish editable data, metadata-only effects,
baked output and unsupported operations. Extension contracts remain bounded;
data presets and executable plugins have different trust requirements.

### 7. Verify the result people actually use

Tests cover domain behavior, persistence, real media processing and user
journeys. Preview and output should agree on timing, geometry, text and audio.
Synthetic checks, physical workstation observations and release readiness are
reported separately. Performance claims require a stated workload and measured
results.

## Scope and boundaries

| Area                    | Direction                                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Media organization      | Source adapters, metadata with provenance, duplicate/event evidence, selections and portable catalogs.               |
| Story authoring         | Reusable structures, custom outlines, scripts, graphs and reviewable media selection.                                |
| Composition and editing | Duration constraints, non-destructive edits, audio/captions, shared preview/render behavior and recoverable changes. |
| Delivery                | Local render, supported interchange, compatibility reports, relinking and media collection.                          |
| Extensibility           | Documented provider/source/export boundaries and bounded local presets, with explicit compatibility and trust rules. |

Current work prioritizes completing and validating the local workflow. Hosted
collaboration, a marketplace, a mobile editor and a general-purpose GPU effects
engine are outside the present delivery scope. Source recognition is also
separate from support for decoding, stitching or reframing a camera format.

Large-library processing is a design concern, not an established capacity
guarantee. Pagination, bounded analysis and measured workloads guide expansion.
The [current architecture](architecture.md) and [source support guide](source-support.md)
describe implemented boundaries; historical sketches do not override them.

## How changes fit the project

A useful proposal names the user problem, the existing component responsible
for it and the observable outcome. It explains what the user can review, how the
change behaves when interrupted, how old projects remain usable and how its
result will be verified. A smaller complete workflow is preferable to several
unfinished surfaces with independent state.

Contributors can start with documentation, translations, reproducible bug
reports, generated media fixtures, compatibility testing or focused code changes.
Larger proposals belong in a discussion or issue before implementation; see
[Contributing](https://github.com/bynanci/open-film/blob/main/CONTRIBUTING.md).

## Open-source foundation

Current first-party material is licensed under Apache-2.0. Existing local
features are free to use, including commercial use under the license's terms.
Optional provider fees and third-party media, fonts, runtimes and model licenses
remain separate. The [licensing guide](licensing.md), repository
[LICENSE](https://github.com/bynanci/open-film/blob/main/LICENSE) and
[NOTICE](https://github.com/bynanci/open-film/blob/main/NOTICE) record the policy
and obligations.

## Further reading

- [User workflow](product-workflow.md): how the product is used.
- [Architecture](architecture.md) and [contracts](CONTRACTS.md): current technical owners and interfaces.
- [Project format](project-format.md): saved data and compatibility.
- [Architecture decisions](adr/001-monorepo.md): the rationale behind the current structure.
- [v1 readiness](roadmap/v1-readiness.md): delivery work and remaining evidence.
- [Research index](https://github.com/bynanci/open-film/blob/main/research/README.md): external ideas and hypotheses, distinct from accepted scope.

_Modified by OpenFilm contributors on 2026-10-31. Current OpenFilm first-party material is Apache-2.0; historical grants remain available. See LICENSE and NOTICE._
