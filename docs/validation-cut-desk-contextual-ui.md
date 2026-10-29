# Cut Desk contextual UI — validation

Date: 2026-10-29. Stacked implementation base:
`299df3f0634d0ff64a1ec6feb10d8229ad20dbc7`.

This bounded Professional Cut Desk Phase 1B slice adds the Edit Decision Ribbon
and diagnostic film-look comparison. It does not add a timeline, project field,
render option or media cache identity. Record context comes from the existing
Composition frame resolver; Source context comes from the selected clip and
existing Precision surface.

## Interaction and safety evidence

- The Ribbon presents `Sequence → Beat → Clip → Source`, Record sequence/source
  clocks, Source sequence-in/source clocks, separate clip/source protection,
  real Precision snapping state when applicable and current action/save status.
- Source labels the fixed selected-clip boundary as `Sequence in`; its Source TC
  follows the Precision playhead and is not misrepresented as a moving sequence
  clock.
- Record Beat/Clip/Source follows the resolved primary at the Record frame, not a
  stale selected Story card. Crossing an edit updates the Ribbon and fences a
  latched comparison.
- Momentary comparison supports pointer hold and Space/Enter hold. Pointer-up,
  cancellation, capture loss, button blur, window blur and visibility loss clear
  it. The explicit latched state survives blur but clears on Escape or a
  project/composition/revision/timebase/target/active-source context change.
- Compare keydown defers to modifier chords, IME composition, modal dialogs and
  already-handled events. Keyup still releases a hold it already owns.
- Compare removes only current browser look filters. It is absent from
  `ownerKey`, `resourceOwner`, Composition, Undo/Redo and render requests. Video
  and controlled PhotoPresentation nodes keep their identity while comparing.
- Browser regression observes zero write requests, byte-equivalent saved
  Composition data and unchanged source hashes after momentary, keyboard,
  latched, blur, Escape and Record/Source flows.

The visual hierarchy follows the existing Quiet Studio tokens rather than an
Instagram/Apple clone: one compact decision ribbon, tabular clocks, semantic
blue status, textual lock/snap/action states and compare controls inside the
existing transport row. Screenshots and browser checks cover English,
Traditional Chinese, Japanese and pseudo-locale layouts from 640 to 1,920 CSS
pixels without page overflow or clipped primary controls. The fixture activates
a real look, asserts both Compare controls exist and runs axe against the Cut
Desk rather than inferring coverage from an absent conditional control.

## Automated evidence

Test-first execution initially failed exactly at the missing contracts: no
Ribbon component, no Record look bypass and no owner-fenced compare state. The
focused corrected execution is:

```text
pnpm exec vitest run \
  tests/unit/edit-decision-ribbon.test.ts \
  tests/unit/record-monitor.test.ts \
  tests/unit/timeline-clip-render-boundary.test.ts \
  tests/unit/native-benchmark-checkpoints.test.ts

4 files, 162 tests passed
```

Relevant browser evidence:

```text
pnpm exec playwright test \
  tests/e2e/film-looks.spec.ts \
  tests/e2e/workspace-modes.spec.ts \
  --grep "Expert Record compares|keeps expert tools readable" --workers=1

2 tests passed

pnpm exec playwright test tests/e2e/film-looks.spec.ts
10 tests passed

pnpm exec playwright test tests/e2e/workspace-modes.spec.ts
22 tests passed
```

The film-look file includes actual SVG/FFmpeg encoded-SDR pixel comparison for
all six shared look recipes. Compare itself is intentionally preview-only, so it
does not create a new render request or modify the existing FFmpeg parity
contract.

| Gate                             | Result                                |
| -------------------------------- | ------------------------------------- |
| `pnpm install --frozen-lockfile` | passed on the stacked base            |
| `pnpm format:check`              | passed                                |
| `pnpm test:i18n`                 | passed; 2,423 semantic keys           |
| `pnpm test:docs-i18n`            | passed                                |
| `pnpm lint`                      | passed                                |
| `pnpm typecheck`                 | passed                                |
| complete `pnpm test`             | passed; 298 files / 4,291 tests       |
| `pnpm build`                     | passed                                |
| complete `pnpm test:e2e`         | passed; 277 browser tests             |
| `pnpm test:interchange`          | passed; 18 OTIO parser tests          |
| `pnpm test:native`               | not run locally; Cargo is unavailable |

Independent final review reports zero Critical, Important or Minor defects.
Real Resolve import, physical Windows/macOS input, high-DPI and color-managed
display behavior are not established by these automated results.

## Manual and deferred gates

Physical Windows/macOS pointer capture, keyboard repeat, trackpad behavior,
high-DPI scaling and color-managed comparison remain workstation gates. Browser
look comparison is not a reference color monitor. Dual-monitor/resizable Cut
Desk completion, pointer-centred Precision zoom/pan, temporary snap bypass and
Phase 2 editing semantics remain explicitly incomplete.
