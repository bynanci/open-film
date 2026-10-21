# ADR 003: Versioned directory project with SQLite and source references

Status: Accepted.

## Context

Projects need durable preference edits and open story/timeline documents while
original libraries can be large and live outside the project.

## Decision

Use an `.openfilm` directory with a validated JSON manifest, SQLite catalog,
analysis documents, and regenerable cache. Store story/composition models in the
current manifest. Reference original media by URI; do not copy it into projects.
Version the manifest (1.0.0) and catalog (`user_version=1`) independently of the
application release (0.1.0). Support only documented migrations.

## Consequences

Projects are inspectable and remain local. Moving a project does not move its
sources; absolute URI relinking is future work. Backups need the catalog and
manifest plus separate source backups. Atomic manifest writes and SQLite WAL
provide per-store durability, not a transaction spanning both stores. Reserved
story/timeline directories allow future standalone documents without claiming
they are currently canonical. See `docs/project-format.md`.

## Superseding update — 2026-10-05

Relinking is now implemented; the earlier statement that absolute URI relinking
is future work is superseded. Assets retain their IDs and original provenance
while their current local URI and `metadata["openfilm.reference"]` change in one
SQLite transaction. This additive extension records library-relative location,
logical volume identity and current root without changing project schema 1.0.0
or catalog schema 1. Current roots remain in the catalog, so relinking does not
require an atomic write across JSON and SQLite. Original library URIs in the
manifest remain import/provenance information.

New cache references are relative to the project. Recognized legacy generated
cache paths are recovered when reopening a moved project. Sources remain outside
the project and need separate backups. Hash-first matching, explicit confirmation
for weaker legacy matches, apply-time validation and collision checks protect
source identity. Physical-volume auto-detection and native removable-drive
verification remain deferred.

The current decision is documented in [project format](../project-format.md),
[media portability](../media-portability.md) and the
[relinking contracts](../RELINK_CONTRACTS.md).
