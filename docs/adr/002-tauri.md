# ADR 002: Vue workspace and Tauri shell with a local Node service

Status: Accepted for the first vertical slice.

## Context

The desktop needs a native window/folder picker and offline media processing.
Reimplementing the TypeScript application, SQLite, and media adapters in Rust
would duplicate the headless workflow before it is validated.

## Decision

Use Vue 3/Vite for the interface and Tauri 2 for native integration. Keep the
application/media runtime in a loopback Node service. Rust commands currently
provide folder selection. The shell can start a service using explicit absolute
Node/script paths and owns the child process it starts.

## Consequences

The browser and shell share the same behavior; core remains UI-independent.
Development starts the loopback service on 4310 and UI on 1420. A native binary
alone does not provide a self-contained installation: runtime/service/media-tool
bundling, readiness/error handling, signing, updates, and platform validation
remain delivery work. Installer bundling is disabled. Rust build checks require
host Tauri/webview development dependencies.
