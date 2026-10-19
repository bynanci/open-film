# GraphicScene v1 threat model

## Assets, actors and boundaries

Protect original media, project/history state, local files and network credentials,
the application process and other open projects. Project JSON and HTTP command
bodies are untrusted data. Catalog source bytes can change outside OpenFilm. The
application, local font configuration, built-in numeric SVG generator and installed
FFmpeg/resvg/fontkit binaries form the trusted execution boundary. Loopback API
access retains the service's existing origin and request checks.

| Threat                                                | Boundary and control                                                                                                                                                                                                                                                  | Verification                                                                                                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project JS/HTML/SVG execution or expression injection | Exact version/type/field allowlists at every tree level; literal text is shaped to local glyph PNGs; generated SVG uses numeric values and fixed enum/color syntax only. No eval, browser page, project script, CSS or raw markup.                                    | Reject unknown fields/types/versions, HTML/JS primitives, expression-valued geometry and malformed colors. Literal markup remains visible text.   |
| SSRF, file exfiltration and decoder resource lookup   | Image nodes reference catalog IDs only. Actual source must be local and have PNG/JPEG/WebP magic. Decoder protocol allowlist is file/pipe, with real dimensions and byte limits. Only generated PNG data URIs enter trusted SVG; no project URL/path is interpolated. | Remote/catalog URIs, disguised SVG/HTML, missing IDs, malformed images and oversize sources fail with typed errors.                               |
| CPU, memory or disk exhaustion                        | Bounded trees, depth, text, geometry, duration, output pixels/fps, active frame work, texture bytes/pixels and sequence bytes. Subprocesses have time/output limits; loops check AbortSignal. One preview request per application at a time.                          | Boundary tests, deep/cyclic/oversize payloads, nonfinite values, oversized render budgets, cancellation and cleanup.                              |
| Stale source or revision silently rendered            | Snapshot validated Composition/settings/assets. Hash sources before preparation and verify after work. Preview requires project ID, saved revision and output frame; recheck revision after asynchronous work. No shared cross-project frame cache.                   | Source mutation, stale revision, closed/project-switched owner and private cleanup regressions.                                                   |
| Cache traversal or another project's data disclosure  | Private work is under a verified project cache root or the renderer's private work directory. Names use runtime random IDs and numeric indices, never scene IDs or text. HTTP returns bounded PNG bytes with no-store, not arbitrary files.                           | Malformed identifiers, symlinked cache, sequential project switches and cancellation leave no published partial output.                           |
| Lost manual edits or broken source protections        | Graphic commands use existing revision/request/history/persistence logic. All validation precedes save acknowledgement. Duration conflicts reject without silently clipping scene content.                                                                            | Application tests for unchanged bytes/revision on rejection, stale edit, Undo/Redo, reopen, locks and legacy projects.                            |
| Misleading output or interchange                      | Monitor and FFmpeg share frame rasterization and integer output-frame timing. JSON/OTIO retain data; unsupported NLE output rejects or warns.                                                                                                                         | Decode actual synthetic MP4 at first/middle/last and nonsequential seeks; assert layer/text positions, source hashes and interchange diagnostics. |

## Residual risks and explicit limits

Native image/font parsers remain dependencies; this schema is not a sandbox for
arbitrary third-party native binaries. Local administrators can change trusted
fonts/executables. No remote provider is used. Frame encoding can differ slightly
after H.264 chroma subsampling; pixel comparisons use bounded tolerances. Hardware,
4K throughput, physical display quality and downstream NLE recreation are separate
manual gates. Source paths stay in existing private manifests, never public fixture
or CI data. All committed media evidence is synthetic/CC0.
