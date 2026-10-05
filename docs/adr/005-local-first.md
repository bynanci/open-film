# ADR 005: Offline default with explicit remote consent

Status: Accepted.

## Context

Media collections include personal images, speech, locations, and private moments.
Basic organization and storytelling must work without transmitting them.

## Decision

Use local files, SQLite, FFmpeg/FFprobe, local metadata extraction, and observable
offline ranking. Bind the service to loopback and restrict allowed browser origins
and file streaming. No remote provider is instantiated by the default workflow.
Remote provider contracts declare endpoints and data kinds; SDK consent guards
require explicit opt-in for a named provider and disclosed payload kinds.

## Consequences

Installed dependencies/tools are sufficient for offline import-to-export use.
Initial installation and optional browser-tool downloads need network access.
Consent guards are interfaces/validation, not a sandbox or automatic interception
of all plugin network access. Remote integration must call the guard immediately
before passing data and supply clear UI disclosure. Exported project metadata
still needs deliberate handling when shared.
