# Security and Professional Cut Desk Refinement

Status: Approved 2026-10-29  
Design base: `c1d582b9b5ec8daadeab88048ac73d70999c8c39`  
Sequence: A → B → C → D

## Goal

Reduce a newly reported production dependency risk, recover only still-useful
editing behavior from the unmerged direct-manipulation branch, make focused
architecture and UX improvements along the existing Professional Cut Desk
roadmap, then reconcile the proposed seven-subsystem v0.5.0–v1.0.0 roadmap
against the latest implementation. Keep the existing Composition, typed edit
commands, project contracts, history/autosave, shared application services, and
FFmpeg path authoritative.

## Evidence and current boundaries

- Latest GitHub `main` is `c1d582b9b5ec8daadeab88048ac73d70999c8c39` (PR #57).
- There are no open PRs. The only open issue is #7, whose remaining acceptance
  requires candidate-bound Resolve, real model/provider, GPU, camera, sustained
  4K, installer, and cross-process workstation evidence.
- `apps/desktop` currently pins `vue-i18n` 11.4.13. GHSA-83rm-6c8r-g728 and
  GHSA-8rc2-428q-7ww3 report a fixed version at 11.4.14. The advisories were
  published after the latest recorded security workflow run.
- Repository search found no `v-html`, `srcdoc`, `innerHTML`, or enabled
  `escapeParameter` configuration. This is no demonstrated reachable XSS path,
  but it does not remove the production dependency/audit finding.
- `codex/direct-manipulation-editing` has two commits (ending at
  `1440e95b7bd1bbf40883de49c007574f2354fac1`), no associated PR, and about 3,554
  changed lines against the current base. It adds `PreviewTransformOverlay`,
  `TimeTrackEditor`, and gesture/history tests; these files are not present on
  latest main. Some behavior may overlap with current timeline, monitor, and
  Cut Desk implementations and must be evaluated before any port.
- Professional Cut Desk Phase 1A is integrated. Its roadmap still lists Phase
  1B/1C and physical workstation gates as incomplete. Large desktop files are
  maintainability signals to investigate, not proof that a broad rewrite is
  warranted.

## Proposed sequence

### A — Patch and verify the dependency

1. Upgrade the direct Vue I18n dependency to the minimum patched stable release
   (`11.4.14`) and regenerate only the necessary lockfile entries.
2. Do not opt into `escapeParameter`, HTML translation rendering, or a major
   dependency migration as part of this change.
3. Verify the exact resolved versions, production audit, i18n tests, and the
   repository's available format/lint/type/unit/build/browser/interchange gates.
   Confirm the security workflow runs on the resulting branch head.
4. Report whether the application remains without the advisory's HTML-rendering
   prerequisites. Do not claim a direct XSS exploit or a security certification
   from the dependency update alone.

### B — Review and selectively recover old interactions

1. Compare the old branch's overlay, proportional time editing, snapping,
   gesture commit/cancel, keyboard, lock, history, and stale-revision behavior
   with current main and the Phase 1A contracts.
2. Classify each behavior as `already covered`, `useful gap`, or `unsafe/stale`,
   with file/test evidence.
3. Port only approved `useful gap` behavior into a fresh branch from latest
   main. Reuse existing typed edit commands and session history; do not merge or
   rebase the old branch wholesale, create a second timeline, or weaken locks.
4. Keep the old branch intact as recovery material. A port must preserve
   source/project immutability, Undo/Redo, autosave/reopen, keyboard access,
   deterministic preview, and stale-revision fencing.

### C — Focused Cut Desk architecture and UX refinement

1. Use current Phase 1B/1C roadmap and the B comparison to select one coherent
   user journey, rather than refactoring by file size alone.
2. Keep the monitor, decision ribbon, compare view, and precision editor on the
   existing Composition and shared application path. Extract UI modules only
   where a clear responsibility and stable contract are demonstrated.
3. Preserve General/Expert mode, current design tokens and i18n, CJK wrapping,
   keyboard/IME behavior, responsive layouts, accessible focus/labels, and
   operation-specific locks.
4. Add interaction tests at the relevant narrow/desktop sizes and for the
   selected end-to-end edit journey. Keep physical trackpad, high-DPI, audio
   latency, color-managed display, and long-session workstation checks marked
   manual unless actually performed.

### D — Evidence-backed seven-subsystem roadmap

1. Audit the latest main implementation and validation evidence for the seven
   proposed product areas: Story/solver, photo geometry/render, Cut Desk/audio,
   transcript/captions, color/output, catalog/portable media, and cross-platform
   UI/CI.
2. For every proposed v0.5.0–v1.0.0 capability, classify it as `implemented`,
   `partial`, `missing`, or `manual/workstation gate`, with current paths,
   contracts and tests. Correct historical anchors that no longer match current
   main—for example Catalog v6 and PR #57—without erasing useful provenance.
3. Explicitly verify likely overlap before adding work: cross-dissolve, waveform
   extraction/display, proxy generation, caption styling, PhotoDepth/focal
   protection, film-look/color evidence, Collect Media, declarative templates,
   native packaging and synthetic FFmpeg fixtures may already cover part of the
   proposed gaps.
4. Produce an evidence-backed roadmap document and update `TASKS.md` and
   `ROADMAP.md` with only confirmed gaps, dependencies, security boundaries,
   validation requirements and manual gates. Claims such as Figma alignment,
   external corpus inclusion or competitor capability require repository or
   public-source evidence; otherwise label them unverified and omit them from
   engineering acceptance.
5. Preserve contract-first sequencing. High-risk items—HDR tone mapping,
   transcript ripple edits, media consolidation, installer sidecars and plugin
   schemas—must receive their own threat/compatibility design and implementation
   plan before product code changes. D does not silently broaden C into all four
   future releases.

## Issue and PR handling

- Keep Issue #7 open until the required real workstation observations are
  recorded against the exact candidate SHA and reviewed. CI, synthetic media,
  and structural validation are not substitutes.
- Refresh stale Issue #7 implementation references only after reconciling them
  with current `docs/workstation-qa.md` and validation records; retain blocked
  and failed attempts and never manufacture evidence.
- There are no open PRs to merge now. Deliver A, any accepted B port, C and D as
  separate reviewable changes. Do not merge or publish a release as part of
  this design unless separately authorized.

## Explicit non-goals

- Closing Issue #7 without workstation evidence.
- Rewriting the editor architecture wholesale or moving every large Vue file.
- Merging/deleting the stale direct-manipulation branch without review.
- Adding remote services, changing project schemas, creating another timeline,
  or changing media ownership/rendering contracts.
- Treating the advisory as proof that current OpenFilm has a reachable XSS.

## Acceptance

- A: patched stable Vue I18n is locked; production dependency audit is clean;
  i18n and selected repository gates pass on the exact candidate head; the
  security workflow result is recorded.
- B: every old-branch interaction has an evidence-backed disposition; any
  recovered behavior has regression coverage and passes the existing edit,
  history, persistence, accessibility, and preview contracts.
- C: the chosen Cut Desk journey has explicit task-flow goals, accessible
  responsive interactions, regression evidence, and documentation of remaining
  manual gates.
- D: all seven subsystem assessments and proposed v0.5.0–v1.0.0 capabilities
  have an evidence-backed disposition; only verified gaps enter the task queue,
  and no existing capability is scheduled for duplicate implementation.
- Issue #7 remains open until its real-world acceptance evidence is complete.

## Approval gate

This design was approved on 2026-10-29. Execute A → B → C → D with independent
verification and reviewable change boundaries.
