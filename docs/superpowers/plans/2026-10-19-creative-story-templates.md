# M4 / F02 — Creative Story Templates implementation plan

Base: `ab072e660d5913397efe1b98394611d2350bf895` (M3 merge on `origin/main`).
Spec: `docs/superpowers/specs/2026-10-19-creative-story-templates-design.md`.

## Global constraints

- Keep `GraphicScene` v1 as the rendered scene contract and use its existing
  commands, evaluator, shared Monitor/FFmpeg raster, and Composition timing.
- Template metadata is optional, strict JSON bound to existing scene/node IDs;
  keep legacy projects valid and keep Undo/Redo, autosave, locks, and reopen.
- GPX and text are untrusted bounded data. Never fetch URLs, expand XML
  entities, run project content, infer GPS/time/results, or rewrite source media.
- Use fictional chat, synthetic GPX, and generated photos in tests/artifacts.
- Update TASKS, ROADMAP, the creative-scene roadmap, contracts, architecture,
  and a validation record; preserve Apache-2.0 and NOTICE.

## Steps

1. **Core template metadata contract.** First add failing core tests for
   optional legacy compatibility, strict template metadata, scene/node
   referential integrity, exact quote/excerpt source rules, GPX limits, and
   photo relationship asset/focus data. Then implement the types and validator.
   Expected: core tests prove malformed or orphaned records are rejected and
   valid legacy/three-template data round-trips without mutation.

2. **Deterministic story builders and GPX importer.** First add failing
   `packages/story/tests/graphic-templates.test.ts` cases for all three builders,
   CJK/long messages, sequential timing/easing, exact quote/excerpt labels,
   imported/manual route honesty and limits, photo focus protection, and shuffled
   arbitrary seeks. Then implement pure builders and bounded GPX parsing/hash.
   Expected: generated scenes pass the existing v1 validator and repeated seeks
   produce byte-identical evaluated node data.

3. **Atomic editor persistence.** First add failing solver/application tests for
   one command saving scene+template metadata together, generic node edits
   retaining provenance, scene removal clearing metadata, and lock-preserving
   Undo/Redo/reopen. Then extend command admission and application. Expected:
   reopen preserves stable bindings and exact source hashes; unrelated locked
   clips and media are unchanged.

4. **Desktop Gallery and Inspector.** First add browser tests for gallery
   selection, one/four-message creation, quote/excerpt labels, explicit GPX file
   import with no fabricated time/results, three photo relationship modes,
   replacing assets/text/timing/animation, CJK layout, keyboard access, and
   save/Undo/Redo/reopen. Then implement localized Vue components and wire them
   into the existing Edit inspector and command queue. Expected: browser tests
   exercise saved generated GraphicScenes and existing preview, without another
   timeline.

5. **Actual FFmpeg regression.** First add a failing integration test that
   builds a synthetic 24-second Composition with all three templates, invokes
   the real FFmpeg renderer, decodes output frames at opening/middle/ending and
   compares duration/frame count, source hashes, visual bounds, and expected
   template content. Then implement the fixture/workflow evidence collection.
   Expected: a decodable MP4 and manifest are produced using only generated
   images/fictional text/synthetic route; CI uploads the synthetic evidence.

6. **Documentation and release gates.** Update current milestone queue and scope
   to M4/F02, shift the existing F05/F08 and audio work to the next queued
   milestones, and record exact local/CI/manual outcomes. Run the requested full
   repository gates serially where they share ports. Expected: validation report
   states exact pass/fail/unrun commands and no unsupported physical-display,
   hardware, 4K, or NLE claim.

7. **Review and PR.** Review the complete branch against the spec and threat
   boundaries, fix correctness findings with test-first regressions, commit the
   implementation, push the independent M4 branch, create and attach one PR.
   Do not merge it.
