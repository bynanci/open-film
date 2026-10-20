# M7C — Reviewable NLE fidelity handoff

Base: main bb2c4521ad894478893485119442a00ffd9b34cc. M7B #36 and M8A #35
remain open. Their optional stems and depth capabilities are not claimed here.

## Design

Portable HandoffPlan v1 describes each present feature, owner, half-open frame
range, disposition and reason. Preserve editability is default. Visual fidelity
explicitly replaces the union of unsupported visual ranges with opaque precomps;
cuts outside that union stay native. Alpha overlays remain disabled. The existing
renderer produces the full context once, then frame trims produce short clips
without resetting graphics/transition/caption animation. Optional full audio mix
uses that render and replaces native audio tracks. Stems await M7B. Additional
SRT/VTT preserve caption timing; only one explicit language is burned in.
Original Composition and source mappings survive in path-free provenance. Source
copies use relative media references. Project schema/history remain unchanged.

## Implementation and acceptance

1. Red/green pure exporter tests: feature classification, ranges, native/baked,
   fractional frame rate, unsupported fields and off-grid refusal.
2. Application service: saved revision and full source hashes; private unique
   staging directory; same Renderer; actual frame extraction/decode; immutable
   source copies; final synchronous revision fence and atomic directory rename.
   Test cancel/stale/source changes/codec failure/path safety and partial cleanup.
3. Shared CLI/HTTP/Desktop: review plan before explicit export; cancellation,
   project-switch fencing and protected file downloads. No second timeline.
4. Official OTIO 0.18.1 read/write/read, full available gates, fresh correctness
   review, docs/TASKS/ROADMAP and one unmerged PR with exact base/head evidence.

## Risks and manual gates

Full-context rendering favors correctness over performance. Precomps sacrifice
editability only in reviewed ranges. Unknown effects, unsafe/changed/missing
sources, off-grid bake boundaries, alpha/stem requests fail closed. Resolve
relinking, channel/color interpretation and real playback remain workstation
not-run until actual evidence. No project-authored JS/HTML or remote fetch.
