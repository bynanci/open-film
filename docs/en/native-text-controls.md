# Native on-screen text: size, fade and bottom safe distance

## Use the controls

In **Edit**, select a photo or video, then open **Clip inspector → On-screen
text**. Enter the text and choose its role and position. The additional controls
are:

- **Text size**: composition pixels, independent of monitor/window zoom. With no
  saved override, the displayed value follows the text role and project frame
  height; opening the inspector does not save that calculated default. Editing
  the value saves an explicit size, preserved through later role/frame changes.
  **Use role default** removes only `fontSize`, retaining weight, fade, margin
  and the other authored style properties. The existing domain accepts positive,
  finite sizes up to 4,096 pixels, including fractional values; a valid size does
  not guarantee that the complete text fits the frame.
- **Text weight**: **Regular (400)** or **Bold (700)**, using available local font
  faces. An existing custom weight is preserved and shown as the current weight;
  opening the inspector does not reset it. Older subtitle defaults remain
  unchanged. Selecting Bold is not a claim that every installed font provides
  arbitrary weights.
- **Text fade out**: seconds, from **0 to 10**. Zero keeps text fully visible
  until the clip ends. A positive value fades the text and its optional scrim
  together at the end of the clip.
- **Bottom safe distance**: **0–30%** of the composition height. The default is
  **8%**. Increase it to keep a bottom-position caption farther from the bottom
  edge. The distance includes the outside of the optional scrim; it is not a
  distance from the baseline or a percentage of the source photo.

The controls use the existing presentation command and autosave/history flow.
Undo and Redo restore the complete style; saving, closing and reopening retains
the authored values. Locked clips, locked primary sources and locked paired
photos reject these edits. Resetting the title style restores the defaults
without deleting the text. Replacing a photo with a video, or the reverse,
preserves the authored text style.

These are local graphic text layers, including the **Subtitle** graphic role.
They do not create a Caption Track or change transcript text, word alignment,
speech timing, source audio, clip duration, or the Story.

## Timing and layout contract

`TitleStyle` remains optional and version 1. These optional properties extend
the existing project schema without a catalog migration:

```ts
{
  version: 1,
  role: "subtitle",
  position: "bottom",
  background: "scrim",
  fontSize: 64,       // composition pixels; omit for the current role's default
  fontWeight: 700,
  fadeOut: 1.25,       // seconds; default 0
  bottomSafeMargin: 0.12 // frame-height fraction; default 0.08
}
```

The size control exposes the existing optional `TitleStyle.fontSize` field;
it adds no schema field or catalog migration. Numeric fields must be finite
numbers within their documented ranges. Invalid
commands reject the whole batch before saving or adding history. A client must
convert the displayed percentage to a fraction: **12% → 0.12**.

Fade uses **clip-local timeline seconds**, independent of source-in, source-out,
playback speed and the clip's timeline start. The effective fade is the smaller
of the authored fade and the actual clip duration. Opacity decreases linearly
from 1 to 0 during that final interval; it is 0 outside the clip. A 1.25-second
fade on a 0.5-second clip therefore fades over 0.5 seconds. The saved 1.25-second
setting remains intact so a later duration change can use it again.

Trimming, retiming and splitting retain the authored style. A split preserves
the existing behavior of duplicating the native text on both resulting clips;
each half evaluates its own end fade against its own duration. This is not an
automatic division of a sentence into subtitle cues.

Core's measured layout uses the selected local font and a lower safe boundary
derived from the frame height. Bottom-position text anchors to that boundary.
Center-position text retains the existing 8% safe bounds and ignores the custom
bottom distance without deleting its saved value. Large text or excessive line count can still fail to fit;
reduce the font size or split the text rather than assuming that the margin
guarantees readability on every display.

Desktop and FFmpeg share the style resolver, measured PNG text graphic and
opacity calculation. Fade affects the native graphic, including its scrim; it
does not fade the media, frame, transport controls or audio. The same text
placement applies to photo and video sources, including moving-photo previews.

## Subtitle export boundary

[Composition-aware subtitle export](composition-captions.md) is a separate
workflow. SRT/WebVTT export derives cues from transcript/composition timing;
native title fade and bottom margins are not serialized as portable SRT/VTT
styling. This change does not add transcript-caption burn-in. Editable NLE
handoff still requires manual recreation of native title styling/effects where
the target format or editor does not support them.

## Text-size reference boundary

This additive follow-up adapts the visible text-size control concept discussed in
[PR #23](https://github.com/bynanci/open-film/pull/23), inspected at
`b3928dae8986e949bb36a23441c582aa50f137f6`. It uses OpenFilm's existing
`TitleStyle`, measured local raster, presentation command and history contracts;
no implementation source was copied from that candidate.

Top positioning, fade-in and Lanczos resizing are deferred. They need separate
layout/timing/sampling contracts, preview/render parity and regression evidence;
the text-size control does not imply that those behaviors are implemented or
verified. Existing native display and NLE manual gates remain open.

## Verification

Core and render checks passed **25 files / 511 tests**, including actual decoded
FFmpeg frames at 30 and 30000/1001 fps. The native-text pixel cases verify attached
bold Noto Sans text and standalone title layers, scrim opacity, an offset clip
start, trimmed/retimed video, zero and longer-than-clip fades, and unchanged source
pixels/bytes. Bottom distances include the complete visible scrim bounds at 0%,
8%, 20% and 30%; centered text ignores the stored bottom distance. These are
generated SDR fixtures, not display/HDR quality evidence.

The earlier isolated native-text non-port gate passed **175 files / 2,613 tests**
using `pnpm exec vitest run --exclude tests/unit/native-benchmark-runner.test.ts`.
The benchmark runner was intentionally queued separately because another task
owned its fixed service port. The build, TypeScript/Vue checks, lint, i18n coverage
(1,370 semantic keys) and official OTIO validation (18 tests) also passed.
Those development results precede integration. The combined source candidate
passed **179 files / 2,707 non-port tests** and **24 browser cases**, including
native text, photo pull-out and export quality. See
[combined verification](validation-quality-controls.md) for source identity,
screenshots and the final full-gate / CI reporting contract.

Correctness review also exercises a real **Fit to Duration → Preview** action.
Reviewed plans remain plain data in a shallow Vue ref so their command arrays
can be validated/cloned; a deep reactive proxy previously fell back to the saved
clip instead of presenting the shorter candidate. The native text overlay uses
the same candidate clip as the player, so its fade follows the proposed duration.
The regression checks actual overlay opacity and proves that the saved cut and
history remain untouched while previewing.

The text-size follow-up extends the application regression to save explicit
64-pixel text with weight 700, one-second fade and 12% bottom distance, then
Undo/Redo and reopen it. The assertion compares the whole composition, including
an existing automated soundtrack and unchanged source ranges. A size-only reset
preserves all other style fields and remains undoable. Existing clip, source and
paired-source lock cases now include an explicit size edit. These are
application/persistence assertions; browser appearance remains separate evidence.

Focused application and solver regression command:

```sh
pnpm exec vitest run packages/application/tests/quality-editor.test.ts packages/solver/tests/editing.test.ts
```

The focused run passed **2 files / 88 tests** on 2026-10-18 during development.
New assertions cover valid/invalid control ranges, atomic rejection, all three
lock sources, exact request retry, conflicting request-ID reuse, one-step
Undo/Redo, saved project bytes, reopening, cross-media replacement, reset,
shortening, speed, source trim and split isolation. The command proves the
application/domain contracts; it does not establish browser appearance or
rendered pixel parity. Core, decoded FFmpeg frames, localized browser tests and
the complete candidate regression gates must be recorded by the final PR.

Real Windows/macOS presentation, display-safe placement, projector readability,
camera/HDR/4K sources and actual Resolve import remain the existing
[workstation QA gates](workstation-qa.md). Generated fixtures do not close them.

_New document by OpenFilm contributors, 2026-10-18. Apache-2.0; see LICENSE and NOTICE._
