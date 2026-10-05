# ADR 008: Hard constraints with soft pacing targets

Status: Accepted for the first composition solver.

## Context

A useful rough cut must preserve explicit choices and fit its duration budget,
even when candidates overlap or source media is shorter than a desired beat.

## Decision

Treat selected/must-include IDs and library locks as required, rejection/exclusion
as ineligible, and repetition as disabled. Keep beat order and explicit asset-order
edges; allow an explicit chronological constraint. Enforce story/beat maxima,
beat minima, playable clip minima, and source bounds. Treat target durations as
soft preferences. Place required assets first and use bounded search to reserve
unique candidates for minimum coverage before optional scoring/pacing.

## Consequences

Infeasible choices produce an error suggesting changed duration, scope, lock,
selection, or inspection. A target can be undershot when usable material is short.
Conflicting chronological/manual orders are reported. The 50,000-node search limit
asks users to pin/narrow overlapping candidates rather than claiming feasibility
was mathematically disproved. General person/event coverage and media-balance
constraints remain future work.
