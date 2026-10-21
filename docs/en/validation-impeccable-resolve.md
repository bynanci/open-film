# Impeccable UI and portable Resolve QA validation — 2026-10-06

This follow-up extends [PR #2](https://github.com/bynanci/open-film/pull/2) from
`e00c8c3f497248ca34c0a7dd3b1513f149ef356b`. Remote main remains
`10caced98a22b79116f2ec63a965ed9e25c9b272`. PR checks and the generated bundle
record the exact final checkout/candidate SHA; the working tree is not treated as
that earlier immutable commit.

## Design method and implemented behavior

Read Impeccable at upstream `ca6ca49f6a74e2e23adb955fb3801f4aa6426f3d`, including
its [skill](https://github.com/pbakaus/impeccable/blob/ca6ca49f6a74e2e23adb955fb3801f4aa6426f3d/skill/SKILL.src.md),
Operate, Polish and Craft Floor references. The context command recognized an
incumbent UI and allowed scoped refinement without replacing its architecture.
The local-first system/CJK font requirement remains authoritative.

- Compact header/workflow and fixed-rem headings give media more room; Welcome
  places Create/Open beside their explanation. Library filtering and recovery
  remain visible. Workflow states retain screen-reader labels and hover titles.
- Edit uses a measured, bounded workspace. Preview stays above a vertically
  scrolling story rail; clip lanes scroll horizontally and the inspector scrolls
  independently. Arrow selection reveals clips in those regions without moving
  the document. Editing/history/autosave contracts are unchanged.
- Export downloads real editable files as well as MP4. Resolve capabilities are
  progressively disclosed; import/relink/playback steps and unavailable-Resolve
  recovery are localized in all three supported languages. The displayed evidence
  still comes from the compatibility model, whose real-NLE evidence is empty.

One batched browser pass captured Welcome/Create, Library, Story, Edit, Export,
Resolve details, Settings, Import, errors and missing-media recovery at 1280×720,
1440×900 and 1920×1080, plus 1024px layout checks, in en-US, zh-TW, ja-JP and en-XA.
Rendered screenshots were compared with the previous PR baseline. No concrete
defect required another visual iteration. The first Library media row appears
about 150px earlier in the small-desktop reference; Edit no longer puts every
beat into one long page beneath the player.

The single requested mechanical detector scan completed with exit 0 and an empty
findings array across nine changed UI targets. The result is retained at
`/tmp/openfilm-impeccable-detect.json`; it supplements rendered/behavior checks,
not a claim of exhaustive accessibility or native-platform certification.

## Automated evidence

| Check                | Result                                                                                                                                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Translation coverage | 739 semantic keys match en-US, zh-TW and ja-JP, including placeholders/errors.                                                                                                                                   |
| Unit/integration     | 404 tests in 45 files passed.                                                                                                                                                                                    |
| Browser              | 22 cases passed with `CI=1`, no skips; 234 screenshots, three actual OTIO downloads and two MP4s retained.                                                                                                       |
| Editing scale        | 500 clips at 1280×720; actual rail wheel-scroll, last-clip selection and ArrowLeft keep player visible and document/player Y unchanged. Existing lazy-cache, single-decoder and persistence assertions retained. |
| Export downloads     | All three locale journeys compare downloaded OTIO bytes with the saved export, exact original composition metadata and real source URLs/files.                                                                   |
| Accessibility/layout | Existing token contrast, rendered axe A/AA, keyboard/focus, CJK/pseudo overflow and light/system/reduced-motion checks passed.                                                                                   |
| Build and built CLI  | Production CLI/server/Vue build and real generated-media CLI workflow passed.                                                                                                                                    |
| Native targets       | Rust formatting, Clippy and test targets passed; zero Rust behavior tests, no native-window/installer claim.                                                                                                     |
| Resolve helper       | 18 standard-library Python regressions plus official OTIO/source/missing-source/real preparation gate passed.                                                                                                    |

Browser evidence is `/tmp/openfilm-impeccable-browser-pass1` locally and the
`browser-test-results` artifact in CI. The existing regression gate also runs
repository formatting, lint and TypeScript/Vue checks. CI additionally uploads
`resolve-qa-reference-<checkout SHA>` after successful interchange validation.

## Workstation handoff evidence and limits

Actual generated fixtures were copied into a different folder containing Unicode,
spaces, `#` and `&`. Preparation rewrote all 18 clip URLs to present source files
and retained original fixture/media hashes. Manual-template creation remained
not-run. The cloud's actual missing-Resolve invocation wrote blocked evidence and
returned exit 2. Failure-only doubles verify safe project guards and prevent
missing `.drp` exports from reporting API success; they do not simulate a certified
Resolve import.

The helper uses only the installed vendor API where available, attempts OTIO
import without assuming API support, and falls back to the documented GUI route.
The [workstation guide](resolve-workstation-qa.md), bundle manifest, native project
and measured/manual observations provide a concrete handoff. Real import,
playback, media relinking, source endpoint interpretation and manually recreated
effects still require a Resolve-capable workstation. No Resolve/GPU/desktop exists
in this cloud environment, and no capability is newly marked real-NLE verified.
