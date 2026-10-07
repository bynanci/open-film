# Roadmap

OpenFilm's north star is ownership of media, story decisions, and the final edit.
The current release establishes a useful offline workflow; later milestones should
improve that workflow without tying the portable domain to a UI, cloud, or NLE.

Current priorities and evidence are tracked by [user pain point](docs/product-pain-points.md).
Shared geometry (PR #5) and workstation evidence/review recovery (PR #6) are merged
and **Automated Verified**; actual workstation behavior remains a separate gate.
The P0 cancellation slice is **Automated Verified**: the project releases before
a non-cooperating provider settles; final published-head checks are tracked in
PR #8. Ownership-aware recovery of transcription, waveform and scene analysis
is **Automated Verified** in the isolated PR #9 stacked on #8. Actual-child,
SQLite/HTTP/CLI and three-language browser regressions preserve live work,
manual corrections and successor results across confirmed recovery. Future creative milestones remain
deferred; merging development source is not a **Released** installer or
**Hardware Verified** recognition/NLE claim.

The next bounded pain point is capability-aware transcription language defaults:
an English-only provider should not leave Transcript on unsupported Auto with a
disabled action. Precision already adjusts to supported choices; Transcript
needs the same predictable behavior, independently of UI and film languages.

## 0.1 — Local story and rough cut

Implemented: projects, SQLite catalogs, local folder import, metadata provenance,
derived media, duplicate/event analysis, ratings and selection state, generic
stories, an external template, duration-constrained composition, MP4 preview,
timeline export, CLI, local API, and desktop workspace. See [TASKS.md](TASKS.md)
for the detailed release checklist.

## Real editing — Working development tree

The Real Editing Workflow round has added a story-first graphical timeline,
non-destructive clip and beat commands, explicit locks, explainable duration
fitting, undo/redo and durable autosave with conflict recovery. Browser tests
exercise editing, preview rendering and reopening. Single/folder media relinking,
missing/offline state, portable cache references, Pixel/Insta360 source adapters
and safe supported HDR previews are implemented. The generated Proposal reference
workflow and independent OTIO/Resolve preparation make these capabilities testable.

## Global product experience — Working development tree

The editing foundation is merged in PR #1. The product round adds Welcome and
guided film creation, a nonblocking workflow indicator, goal-based import/export,
story boards with separate selected/suggested memories, contextual editing and
recoverable offline-media guidance. Stable workspace IDs, structured error codes
and Vue I18n support English, Traditional Chinese and Japanese without changing
user-authored film text. A separate persisted film locale controls template-owned
defaults; legacy text stays intact. Local theme/preferences, shared visual tokens,
CJK/pseudo layouts and browser accessibility checks support the desktop experience.
See [product workflow](docs/product-workflow.md), [i18n](docs/i18n.md) and
[design system](docs/design-system.md). Exact completed gates remain in TASKS and
the [validation record](docs/validation-global-product.md) and PR checks rather
than implying hardware or real NLE certification.

The Impeccable refinement keeps the same visual system while reducing chrome,
retaining preview visibility during story-rail editing and making editable exports
downloadable. The [portable Resolve QA flow](docs/resolve-workstation-qa.md) moves
the generated reference onto a real workstation via a CI artifact, with hash-checked
local paths and separate manual/API observations. Actual application verification
remains the next external gate; it is not replaced by helper tests.

## Next — Real-world verification and delivery

- Package the native shell with a verified local Node service and media runtime;
  test installation and updates on supported operating systems.
- Perform actual Resolve import QA first, including manual recreation of advanced
  edits currently stored only in OTIO metadata. Expand native effect support only
  with tested preservation; other NLEs follow later.
  The 2026-10-06 application preflight is blocked by the cloud environment's
  absent Resolve installation, GPU and desktop; the
  [Resolve record](docs/resolve-qa-record.md) remains not run pending access to a
  Resolve-capable workstation.
- Validate removable volumes on Windows hardware and representative Pixel HDR,
  Motion Photo and Insta360 source files.
- Record Resolve, ASR/LLM, GPU, camera, 4K, Windows installer and process-recovery
  evidence with the candidate-bound workstation QA contract. Unknown review owners
  now have a confirmed manual escape hatch; automatic Windows/macOS dead-owner
  proof still requires an OS-specific verified implementation.
  Initial review batches use the same exact execution checkpoint in a single
  transaction, preventing a recovered old process from publishing stranded work.
- Improve metadata corrections, timezone handling, sidecar ingestion, and event
  editing without hiding uncertainty.
- Validate real camera orientation/color behavior and future 360 reframing;
  source recognition alone is not stitching or optical validation.

## Then — Extensibility and scale

- Add a discoverable plugin/template registry with compatibility checks and
  documentation, plus additional device/source adapters.
- Add more general event/person coverage and media-balance constraints, together
  with explainable infeasibility reporting.
- Add further optional local vision, embedding, transcription and language providers;
  keep remote integrations explicit and consented.
- Benchmark 10,000–100,000-asset catalogs with published fixtures, memory/latency
  measurements, incremental analysis, background workers, and broader story
  scoping. No such scale claim is made by 0.1.0.

Professional color grading, complex GPU effects, cloud collaboration, marketplaces,
and mobile editing remain deferred. Milestones are priorities, not release dates.

## 0.3 — Media Intelligence & Precision Editing

P0 keeps Story-first editing and adds optional source intelligence: a local Whisper
provider through the existing transcription port, transcript/word persistence and
jobs, reusable waveform and scene analysis, generic markers, portable snapping
and Precision mode inside Edit. SQLite catalog v2 adds analysis tables without
replacing the project/composition engine. Source hashes, successful-only transcript
replacement and shared trim/split history protect existing stories and edits.

The foundation is independently adapted from [VidScribe concepts](docs/vidscribe-reference.md).
Models stay separately installed, GPU falls back to CPU, and transcription language
is independent of interface/film languages. CI fixture output validates protocols
and application behavior; real model accuracy/performance is a separate gate.
See [media intelligence](docs/media-intelligence.md) and [transcription setup](docs/transcription.md).

The foundation is merged as PR #3. Transcript productivity builds on it in 0.3.1
below. Geometry/safe frames, local face detection, highlights/derived compositions
and captions follow subsequent milestones. Real Resolve QA continues to require
a workstation; generated OTIO/parser checks do not replace it.

## 0.3.1 — Transcript Productivity & Reviewable Intelligence

This round builds a correctable text knowledge layer above the merged media
intelligence foundation: shared transcript commands and revisions, conservative
word-alignment state, separate durable undo/redo, search/replace, scoped terminology
and reviewable correction evidence. Offline glossary review is useful without an
AI provider; optional language review stays consented, bounded and human-approved.
The Story-first composition engine and main Library/Story/Edit/Export navigation
remain the same. See [transcript editing](docs/transcript-editing.md),
[glossary](docs/glossary.md) and [review suggestions](docs/review-suggestions.md).

Shared composition geometry follows in 0.3.2 below. Safe frames, local vision,
smart reframing, highlights/derived films and captions remain subsequent
milestones. They are not implemented in this round.

## 0.3.2 — Shared Geometry Contract & Preview/Renderer Parity

Use one composition-frame coordinate contract for source contain-fit, scale,
clockwise rotation and translation. Validate real FFmpeg pixels, transparent
rotation above lower tracks, sample aspect ratio, and browser layout lifecycle.
Preserve the Story-first editor and its existing trim, history and autosave.
See [geometry validation](docs/validation-geometry-parity.md). This milestone does
not certify actual Resolve/camera/color/installer behavior or build a live GPU
multitrack compositor. Workstation evidence and explicit safe review recovery
are merged in PR #6; actual workstation observations remain manual gates.
Later creative features remain deferred.
