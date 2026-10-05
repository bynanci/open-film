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
