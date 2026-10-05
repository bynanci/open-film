# ADR 006: OTIO-first interchange and explicit export limits

Status: Accepted for cut-based interchange.

## Context

Users need editable rough cuts in external NLEs. Different interchange formats
support different operations; silently dropping an edit would undermine ownership.

## Decision

Represent compositions as tracks/clips with source ranges and timeline positions.
Export JSON as the complete model and OTIO as the primary open timeline interchange.
Also provide FCPXML 1.10 and limited CMX3600 EDL. Preserve media URIs, source offsets,
gaps, and rational timing. Reject unsupported edit operations explicitly.

## Consequences

OTIO/FCPXML support cut tracks; nonidentity transforms, titles, transitions, and
within-track overlaps currently require JSON. EDL requires one video track,
frame-aligned integer non-drop rates, and video sources; black events preserve
empty time. Serializer/structural tests do not certify actual NLE round trips.
Compatibility fixtures and application-specific import/export validation precede
expanded edit support.
