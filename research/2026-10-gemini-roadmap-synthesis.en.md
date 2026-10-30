# Synthesis of Shared Gemini Research: References for the OpenFilm Roadmap

[English](2026-10-gemini-roadmap-synthesis.en.md) | [繁體中文](2026-10-gemini-roadmap-synthesis.md) | [日本語](2026-10-gemini-roadmap-synthesis.ja.md)

- Prepared: 2026-10-30
- Original comparison baseline: main at 9c392b7cc8d46f4768d76f30bef30d0397cca8f8, then equal to origin/main
- Follow-up status checked against: main at 1005d381cc2000e0f991fc3e1779ebb2a61cd7ab
- Purpose: retain external research for future roadmap discussions without listing completed capabilities as gaps again.

The original comparison is a historical research snapshot, not a complete account of later main changes. This note was checked against the latest main on 2026-10-30. Use [ROADMAP.md](../ROADMAP.md), [TASKS.md](../TASKS.md) and the relevant validation records for current status.

## Summary

The two Gemini reports raise several research directions worth retaining: performance benchmarks for larger media libraries, measuring editing quality instead of checking only output files, optional local vision or speech models, and validation with real NLEs and Windows/macOS workstations. These directions partly overlap with the existing roadmap and should use its existing items and acceptance records.

Several product-status claims in the reports need correction. The 2,000-item limit applies to a scene-planning scope, not the entire media library. Visual QA/contact sheets and PhotoDepth are already implemented on current main. OTIO parser read/write/read tests exist, but they do not prove that the application can round-trip a complete edit from any NLE or that Resolve has passed workstation validation.

This note records research signals and validation conditions. It does not add a release commitment, technology choice or duplicate backlog item.

## Shared sources and review scope

1. [Feasibility and gap analysis for a local-first AI editing workstation for OpenFilm](https://share.gemini.google/R8lVhb5P0XgU)
2. [OpenFilm system architecture evolution, roadmap progress and engineering delivery research](https://share.gemini.google/8lOh2hiSawHA)

The review covered candidate scale, agent and editing quality, media indexing and vector storage, local vision and speech models, PhotoDepth, OTIO/NLE, CI and workstation validation. Performance figures, model capabilities, dependency choices and release phases in the reports are treated as hypotheses requiring verification, except where a paper is explicitly checked below. They are not OpenFilm measurements or adoption decisions.

## Comparison with the repository

| Topic | Verifiable status on main | Roadmap implication |
| --- | --- | --- |
| 2,000-item candidate limit and larger libraries | [scene-plan.ts](../packages/application/src/scene-plan.ts) sets a 2,000-item cap for one scene-plan scope; [source-analysis.ts](../packages/application/src/source-analysis.ts) sets a 10,000-asset cap for shared source analysis; multi-source manifests have a separate 100,000-candidate boundary in [multi-source.ts](../packages/core/src/multi-source.ts). These are different workflow and data boundaries. They do not mean that the entire catalog is limited to 2,000 assets. | Fixtures, memory and latency benchmarks for catalogs of 10,000–100,000 items are already listed in [ROADMAP: Then — Extensibility and scale](../ROADMAP.md) and the [scale checklist in TASKS](../TASKS.md). Before expanding scene-plan scope, measure indexing, candidate selection, cancellation/streaming and planning time separately. Do not adopt sqlite-vec or LanceDB solely because a report suggests them. |
| Visual QA and contact sheets | M1/F07 is implemented as a shared Application service, with real FFmpeg output, sampled decoding, structured findings and contact sheets. See the [validation record](../docs/validation-visual-qa.md) and [roadmap status](../ROADMAP.md). | The claim that contact sheets are missing is outdated. Art direction, real-footage quality, 4K performance, displays and Resolve/NLE post-production still need human or workstation validation. Measurable automated checks cannot replace editorial judgment. |
| PhotoDepth and 2.5D | Local PhotoDepth in M8A is integrated with the existing GraphicScene/Composition path. It includes protected regions, masks/fallback, bounded parallax and Visual QA; see [PhotoDepth validation](../docs/validation-photo-depth.md) and [TASKS](../TASKS.md). | Do not report existing 2.5D playback/rendering as missing. The automatic depth-estimation model mentioned in the reports is a separate capability. If researched, validate it independently with real portraits, edge artifacts, 4K, licensing and local hardware. Synthetic tests do not close existing manual gates. |
| Editing agents and creative quality | M1/F07 checks measurable issues such as assets, fonts and output frames; it does not claim to judge narrative, pacing or whether an edit is good. The [seven-subsystem reconciliation](../docs/roadmap/seven-subsystem-reconciliation.md) separately identifies adjacent-shot continuity, A/B-roll, emotional arcs and other gaps or human judgments. | Research hard brief/delivery requirements separately from editor preference/narrative quality. Define a dataset, blind-review method and reproducible rubric before proposing creative-quality evaluation as roadmap work. Render pass rate is not an editing-quality score. |
| Local models and vector databases | Provider/Embedding interfaces provide extension boundaries, but the repository has no current selection evidence for FTS5, sqlite-vec or LanceDB. Existing duplicate, time and location analysis is not equivalent to general vector search. | ONNX Runtime, Depth Anything, WhisperX, sqlite-vec and LanceDB are candidates mentioned by Gemini. Any prototype should compare licensing, Windows/macOS CPU/DirectML/GPU support, package size, memory, latency, quality, offline/privacy defaults and model-free fallback before changing the architecture. |
| OTIO and NLE round-trip | OpenFilm currently generates OTIO. The official OpenTimelineIO parser has passed read/write/read checks for time ranges, media references and custom metadata. Advanced effects are mostly metadata-only. The [compatibility document](../docs/nle-compatibility.md) states that real Resolve import/playback is unverified and that a general NLE round-trip does not restore an OpenFilm project. | Describe the gates precisely: parser serialization round-trip is tested; NLE import, relinking, playback, effect translation and export/re-import are separate gates. Define supported formats and fidelity acceptance for each effect before planning full round-trip. CRDT/RGA does not shortcut interoperability validation. |
| Windows/macOS delivery and CI | Linux synthetic rendering and automated regressions exist. A fixed toolchain/font setup and a narrow OS render matrix remain incomplete. Native Windows/macOS shells, hardware, external drives and installation/update gates remain in the [seven-subsystem reconciliation](../docs/roadmap/seven-subsystem-reconciliation.md) and [ROADMAP](../ROADMAP.md). | Gemini’s cross-platform CI and workstation proposal overlaps with existing open work. For each new validation, preserve the exact commit, OS/hardware/tool versions, command, exit code, output summary and sanitized logs. Linux synthetic evidence cannot substitute for a Windows workstation result. |

## Progress on main since the original snapshot

Current main has merged D3A1 Sequence waveforms, D6B derived Collect delivery and the CI fixes and browser gate for Windows issues 66–68. Evidence is in [waveform validation](../docs/validation-sequence-waveforms.md), [Collect validation](../docs/validation-collect-coverage.md) and [Windows recovery validation](../docs/validation-windows-issue-recovery.md). Windows CI adds reproducible OS evidence, but it does not close the gates for a physical Windows 10 workstation, macOS, external drives, native install/update/recovery or Resolve/NLE.

The comparison table retains its original baseline for research traceability. Use the latest roadmap, tasks and candidate-version validation results for future planning; do not treat the original snapshot as a current gap list.

## Check of cited papers

Review date: 2026-10-30. This check assesses whether the reports’ citations support their claims; paper results are not treated as OpenFilm results.

- The abstract of [Timeline-Bench, arXiv:2609.35143](https://arxiv.org/abs/2609.35143) describes 56 real video-editing tasks and 16 agent configurations. The average solve rate is 14.0%, the best is 26.8%, and human editors preferred the reference edit in 83.5% of comparisons. The paper includes both content/brief checks and quality checks calibrated with blind editor ratings in its completion criteria. This supports separating mechanical correctness from creative quality as a research signal; it does not establish OpenFilm model scores or performance targets. The figures 896 runs, 72.9% mechanical pass and 93% false success from the shared reports could not be verified in the abstract; check the full paper and definitions before using them.
- The report associates [arXiv:2610.25649](https://arxiv.org/abs/2610.25649) with a query-centric timeline. Its actual title is _InteractAgent: Agentic Human Motion Interaction with Memory-Augmented Reflection_. It studies robot/motion interaction between people and scenes and does not support claims about video-editing timelines.
- [arXiv:2610.25733](https://arxiv.org/abs/2610.25733) is indeed a query-centric TimelineAgent, but it extracts event timelines across multiple documents; it is not about video-editing agents.
- [arXiv:2610.26275](https://arxiv.org/abs/2610.26275) studies generating causal chains of intermediate events in video. It is relevant to story-event understanding, but evaluates VLM causal reasoning, not automatic editing, timeline manipulation or final-film quality.

## Decision checks for future discussion

Before promoting a research direction to the roadmap, answer the relevant questions and link existing work instead of copying it:

1. **Scale:** Are we measuring catalog size, one planning scope or concurrent analysis? What fixed fixture, hardware, memory and latency metrics will be used?
2. **Creative quality:** Are hard delivery requirements separate from human quality ratings? Who are the blind reviewers, and what rubric, reference edits and data licenses apply?
3. **Local models:** Can install/uninstall, offline behavior, permissions/consent, privacy, licensing, and CPU/GPU fallback be reproduced?
4. **NLE compatibility:** Are we testing a parser, actual import/playback, media relinking, or export/re-import? Are fidelity boundaries clear for each effect?
5. **Workstation evidence:** Do the tested commit, Windows/macOS version, hardware, tool versions, commands and logs all refer to the same candidate release?

Version numbers and phase names remain governed by the main roadmap. This note does not adopt the v0.5/v0.6/v1.0 schedule proposed in the shared reports.
