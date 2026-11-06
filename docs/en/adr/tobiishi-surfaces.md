# ADR: shared Tobi-ishi surfaces and independent task layouts

Date: 2026-11-06. Status: accepted for the Garden Stone UI implementation.

## Context

OpenFilm's accumulated UI work uses a warm stone palette and unequal corners,
but repeated workflow entry points make task hierarchy harder to read. The public
VitePress documentation site has a separate teal skin. Both surfaces need a
recognizable identity without changing editing, recovery or media geometry.

## Decision

Share dependency-free CSS tokens, original stone backing planes and the local
lighting utility in `design/`. Desktop keeps its existing entry points as imports
or re-exports. The website uses its own adapter over VitePress, preserving URLs,
local search, Markdown restrictions and saved theme/language behavior.

Only independent task surfaces receive a shaped backing. Text, hit targets,
media frames, timeline widths and keyboard focus retain predictable geometry.
General mode shows one global progress route and a compact Pipeline status/action
bar; detailed stages remain in the drawer and Expert dock. Existing commands and
save/review/project-ownership guards implement all navigation and quick actions.

Inspector categories use semantic keyboard tabs; its collapse preference belongs
to device preferences, not the project. Common timing and audio controls precede
styling. Script and direction tools remain mounted while visually disclosed, so
pending work and user text remain protected by the same barriers.

## Consequences and verification

There is no new UI framework, Core dependency, project migration, hosted API or
remote runtime service. Pages deployment watches the shared design source once
the public site consumes it. Original/generated assets require explicit origins;
public screenshots must contain only shareable fixture data and identify their
development scope. Website availability continues to distinguish source releases
from unverified native installers and manual hardware/NLE gates.

Contrast, keyboard/focus, script preservation, command safety, browser layouts,
500-clip rendering boundaries and existing regression gates verify this change.
The design metaphor is not a claim of historical garden geometry standards.
