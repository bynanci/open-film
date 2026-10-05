# ADR 004: Small extension contracts and external templates

Status: Accepted; discovery/loading deferred.

## Context

Different sources, story styles, analysis models, and NLEs should extend the engine
without forking its generic domain or requiring a particular cloud provider.

## Decision

Provide a plugin SDK with versioned manifests and ports for sources, metadata,
analysis, story templates, scorers, solvers, renderers, exporters, and optional AI
providers. Put scenario-specific language in external template packages. Register
the first template explicitly in the application. Validate provider disclosures
and scoped remote consent before passing data to a remote implementation.

## Consequences

A real external template demonstrates the contract today. Contracts are not an
arbitrary plugin installer/marketplace, and the current application does not load
unknown community packages automatically. Plugins are trusted code, not sandboxed
code. A discoverable registry, distribution policy, runtime compatibility checks,
and more provider implementations need separate validated work.
