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

## Superseding update — 2026-10-05

The earlier blanket rejection of advanced OTIO edits is superseded by explicit
metadata preservation. OTIO still implements native cut layout: tracks, source
references, 1x source ranges, still holds, audio and gaps. Speed, volume/mute,
transforms, crossfades, titles and clip locks are retained exactly in OpenFilm
metadata, with warnings that these are not native NLE effects. Users must
recreate them manually. Within-track overlaps remain rejected, and FCPXML/EDL
restrictions have not expanded.

Retimed clips export an unretimed native excerpt and, for a longer slow-motion
slot, a labeled padding gap. This preserves later record positions without
claiming a verified native retime. Original source/timeline fields remain in
`metadata.openfilm.clip`, with the complete composition and compatibility report
at timeline level. The application also writes an adjacent `.otio.report.json`.
Retain these files and the OpenFilm project because an NLE may discard custom
metadata; reconstruction from a generic NLE round trip is not implemented.

Verification now uses the official OpenTimelineIO 0.18.1 parser for
read/write/read, with generated-source hashes, bounds, timing and metadata checks.
This is independent-parser evidence, not a Resolve compatibility certification.
Actual DaVinci Resolve import and playback remain a manual gate. The current
decision, feature matrix and manual procedure are in
[NLE compatibility](../nle-compatibility.md); exported artifact details are in
[project format](../project-format.md#timeline-interchange).
