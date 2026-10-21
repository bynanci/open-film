# ADR 001: Portable TypeScript domain in a pnpm monorepo

Status: Accepted for 0.1.0.

## Context

The same media/story logic must serve a desktop, CLI, scripts, and future clients.
Adapters need Node and native media tools, while domain code must remain portable.

## Decision

Use a pnpm workspace with separate core, algorithm, SDK, adapter, application,
UI, and template packages. Implement portable models/algorithms in strict
TypeScript. Bundle CLI/server entry points with esbuild and build the Vue client
with Vite. Use a shared application service for workflow orchestration.

## Consequences

Domain tests run without the desktop or media runtime. Source package exports
currently target workspace development; independently published package artifacts
and compatibility testing require additional release work. Cross-package public
interfaces are documented in `docs/CONTRACTS.md`; concrete adapters stay outside
the domain. CI should cover dependency direction as well as type checking.
