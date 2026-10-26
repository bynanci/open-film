# Professional Cut Desk — UX-first editing program

Status: Proposed for approval\
Date: 2026-10-26\
Repository base: `9f593eba5e067aa60c88579e6198425e5fcfa6a6`

## Intent

OpenFilm already provides a story-first editor, source-precision trimming,
transcript navigation, typed non-destructive commands, locks, autosave,
Undo/Redo and deterministic rendering. The professional editing path should make
those capabilities feel like one continuous cutting desk instead of several
independent panels. A frequent editor must be able to keep their eyes on the
picture, operate with keyboard and pointer interchangeably, understand the exact
scope of every action and recover every accepted edit.

The supplied public Reel is a useful interaction reference, not a visual asset or
brand reference. Its 17.74-second structure keeps the result and operation visible
together while advancing one named state roughly every two seconds. OpenFilm will
adopt that continuity: stable picture context, explicit active step, rapid
before/after inspection and minimal mode switching. No Instagram trademark,
media, layout clone or third-party code enters the repository.

## The human and their work

The primary professional user is editing at a desktop workstation with a keyboard,
mouse or trackpad. Five minutes before opening Edit they imported, organized or
reviewed source media. In Edit they repeatedly play, stop, shuttle, mark, trim,
compare, split and review. Five minutes later they expect a saved, reopenable cut
or a render they can verify. They value predictable shortcuts, frame accuracy,
clear locks, low input latency and dense information more than decorative motion.

General mode remains for occasional creators who prefer guided Story, Precision
and Transcript steps. Expert mode becomes the Cut Desk without changing the
underlying project, Composition or command history.

## Design direction

### Domain

- playhead and edit point
- source and sequence time
- in/out marks
- edit decision and affected scope
- source/record monitor
- track targeting and protection
- review pass and before/after comparison

### Color world

Use the existing Quiet Studio system: carbon work surfaces, monitor black, slate
rails, pearl text and a single cool-blue selection accent. Amber is reserved for
markers and snap targets. Red is reserved for destructive, clipping or recording
states. Functional meaning never depends on color alone.

### Signature

The **Edit Decision Ribbon** is unique to the OpenFilm workflow. It keeps
`Sequence → Story beat → Clip → Source` visible beside sequence/source timecode,
lock state, snapping state and the current edit action. It connects story intent
to professional timing without creating another timeline.

### Defaults deliberately rejected

1. Generic dashboard cards → one spatially continuous cutting workbench.
2. An icon-only mystery toolbar → labelled primary actions, consistent vector
   icons, discoverable key hints and a searchable shortcut reference.
3. A second professional timeline model → alternate dense presentation and new
   typed operations over the existing Composition only.
4. Decorative animation → interruptible 140–220 ms state feedback using opacity
   and transforms, with complete reduced-motion behavior.

## Approaches considered

### A. Phased same-Composition Cut Desk — selected

First remove interaction friction using existing commands, then add professional
editing semantics at the application boundary in separately reviewable phases.
This delivers value early, preserves correctness contracts and lets each semantic
operation prove render, history and reopen behavior.

### B. Full NLE replacement in one release — rejected

This could expose every familiar tool together, but it would simultaneously alter
selection, timing, tracks, rendering and UI. It has the highest chance of creating
a second timeline, weakening locks or shipping superficially complete operations.

### C. Presentation-only polish — rejected

This is fast but leaves professional editors without J/K/L, I/O, edit navigation,
pointer-centred zoom, ripple/roll/slip/slide or track targeting. It would look
better without resolving the actual workflow.

## Decisions after builder review

The product decisions that unblock implementation are explicit:

1. **True Source + Record semantics.** Source owns the selected media and staged
   source marks. Record owns a continuous Composition clock. At wide desktop
   sizes both named monitors may be visible; at constrained sizes one monitor is
   visible at a time. One monitor is always the explicit keyboard target.
2. **Stage, then Apply.** `I` and `O` update transient marks only. **Apply range**
   submits the selected clip edit as one explicit typed transaction. The marks
   never enter history by themselves.
3. **Versioned drop-frame support now.** Sequence timecode uses a durable rational
   project timebase. Drop-frame display and entry are supported for the valid
   NTSC rates instead of being approximated from a floating-point frame rate.
4. **No duplicate ripple implementation.** The existing `trim` command already
   ripples clips at or after the previous edit end. It remains the compatibility
   path and is documented as ripple trim; later phases add only the missing edit
   semantics.
5. **Explicit edit transactions.** The current 400 ms save queue is appropriate
   for ordinary form edits but is not an Undo boundary. Professional Apply and
   pointer commits use an acknowledged transaction API with a queue barrier and
   idempotent request ID so one accepted gesture is exactly one history entry.
6. **Marker scope remains honest.** Phase 1 `M` creates a source marker through
   the existing intelligence catalog only while Source is active. Record/sequence
   markers require a separate saved contract and are not implied by the same key.

## Program boundaries

The program defines a professional baseline, not every feature ever shipped by a
commercial finishing suite. It includes fast source/sequence cutting, multi-track
control, reliable media performance, comparison, scopes and reviewable output. It
does not include arbitrary plugin execution, a node compositor, collaborative
cloud bins, DRM media, live broadcast switching or an unbounded scripting host.

Across every phase:

- one saved Composition remains authoritative;
- original media is never overwritten;
- all durable edits use validated typed commands;
- locks, required selections, stale revisions, autosave, Undo/Redo and reopen fail
  closed;
- General and Expert modes present the same project and history;
- monitor and FFmpeg output preserve the existing parity contract;
- no untrusted project HTML or JavaScript executes;
- UI remains localizable, CJK-safe and fully keyboard accessible.

Accepted edits and staged preferences survive the boundaries stated for their
data. The saved Composition survives reopen; the current in-memory Undo stack is
not described as surviving a process restart. Cross-session restoration remains
the responsibility of Named Versions rather than an undocumented persistent Undo
log.

## Phase 1 — Professional interaction foundation

Phase 1 changes presentation and transient playback control while reusing current
`trim`, `clip.split`, marker, look and history paths. It introduces no new saved
timeline model. It is delivered as three independently reviewable PRs; Phase 1A
is the first implementation unit, not the entire section in one change.

### Workspace

At desktop widths the Expert Cut Desk has four stable regions:

```text
┌ Edit Decision Ribbon: Sequence › Beat › Clip › Source | TC | lock | snap ┐
├ Source monitor ─────────────┬ Record monitor ─────────┬ Context inspector ┤
│ source marks and source TC  │ sequence TC and output  │ clip/transcript/  │
│ active-target border        │ active-target border    │ analysis/markers  │
├ Precision strip: ruler, waveform, marks, edits, zoom ┴───────────────────┤
└ Shortcut/status shelf: active tool, key hints, save and recovery state ──┘
```

The current Precision editor is evolved and decomposed rather than duplicated.
At 1024 px the inspector remains beside the monitor when usable; below the
measured breakpoint it moves below as a bounded region. Panel widths are user
preferences, clamped to safe minimums, resettable and never stored in the project.
When two useful monitor panes cannot fit, Source and Record become labelled tabs;
this is a responsive presentation of the same two targets, not a mode or saved
timeline change.

### Monitor and format behavior

- Initial monitor aspect follows project width/height: landscape, vertical or
  square. A deliberate preview override is labelled as an override and resets
  safely on project change.
- Vertical content receives platform-safe overlays without shrinking into a
  landscape default.
- The selected effective film look has a clearly labelled **Compare** control.
  Press-and-hold temporarily bypasses the look; keyboard hold provides the same
  function. A keyboard-accessible latched state is also available and is visibly
  announced. Release, Escape, blur, source/project switch or transport-target
  change clears momentary comparison; latched comparison clears on Escape or
  context switch. Comparison never mutates the Composition or renderer options.
- Browser-native media controls are not the primary transport. A consistent
  OpenFilm transport owns accessible names, pressed states and time display.

#### Source monitor

- Source plays the selected catalog media or the selected clip's source while
  retaining source-local time, analysis and markers.
- Staged I/O marks are tied to project ID, editor revision, selected clip ID and
  source asset ID. Selection/project changes clear them; an external revision
  change marks them stale and prevents Apply until reviewed or restaged.
- Source frame stepping uses reliable source frame-rate metadata. When that is
  absent, the UI explicitly labels the project-rate fallback and does not claim
  embedded source timecode.
- A source lock never prevents viewing or staging. Apply follows the established
  operation-specific protection rules below.

#### Record monitor

- Record owns a monotonic sequence clock and resolves the existing Composition at
  arbitrary sequence time. Playback crosses primary edit points without selecting
  each clip or restarting transport.
- A shared pure resolver maps sequence time to active clips and source-local time
  using `timelineStart`, `timelineDuration`, `sourceIn`, `sourceOut` and speed. It
  is an adapter over the current Composition, not a second edit model.
- Current and next primary picture sources are pre-armed around edit boundaries.
  Existing supported overlays, transitions, GraphicScene evaluation and audible
  tracks are driven from the same sequence clock. Positive playback is clocked;
  reverse shuttle and discontinuous seeks are deterministic frame seeks.
- Normal Record playback is the interactive parity path. The existing
  revision-bound FFmpeg preview remains the final output-evidence path. Compare
  is explicitly diagnostic and may bypass a look without changing render state.
- Source unavailability shows a bounded placeholder and issue without advancing a
  hidden independent clock. Project/source switch, visibility loss and unmount
  stop transport and release media/audio resources.

### Versioned project timebase

The optional addition to project settings is deliberately small and versioned:

```ts
interface ProjectTimebaseV1 {
  version: 1;
  rateNumerator: number;
  rateDenominator: number;
  dropFrame: boolean;
}
```

`rateNumerator / rateDenominator` is authoritative for sequence frame math.
Legacy `settings.frameRate` remains serialized for existing readers and rendering;
new saves validate that it equals the rational projection within a strict
tolerance. Legacy projects without `timebase` open unchanged and derive a
non-drop rational timebase: common fractional rates map to `24000/1001`,
`30000/1001` or `60000/1001`; other supported values use a bounded reduced
rational representation. Derivation alone does not dirty the project.

Drop-frame is valid only at `30000/1001` and `60000/1001`. It uses `;` before the
frame field, skips frame labels 00–01 or 00–03 respectively at every minute except
each tenth minute, and rejects nonexistent labels on input. Non-drop uses `:`.
Parsing and formatting operate on integer frame counts, round-trip at minute,
ten-minute, hour and day boundaries, and never use rounded `29.97` arithmetic.
Changing only display mode does not retime the Composition; changing the rational
rate after timed content exists is blocked until a separately reviewed conform
workflow exists. New-project presets present the timebase choice explicitly.

### Professional transport

- Clicking a monitor or its labelled target control makes Source or Record the
  active keyboard target. The target is always visible in text and focus styling.
- `Space`: play/pause the active monitor, retained for General and Expert users.
- `J`, `K`, `L`: reverse shuttle, stop, forward shuttle. Repeated J/L changes a
  bounded shuttle tier. Reverse uses deterministic frame stepping because HTML
  media elements do not portably support negative playback rates.
- `←` / `→`: one frame at the active target's declared rate; `Shift` modifies to
  one second without cumulative floating-point drift.
- `↑` / `↓`: previous/next deduplicated boundary of non-overlay primary visual
  clips while Record is active. Source does not mislabel marker navigation as an
  edit point.
- `I` / `O`: stage source in/out at the Source playhead. **Apply range** submits
  one `trim` transaction for the selected clip in Phase 1; Phase 2 may consume the
  same marks for insert/overwrite. Invalid, stale or protected ranges retain the
  marks but disable Apply with a specific reason.
- `B`: split at the Record playhead when a unique eligible clip is targeted.
  `M`: existing source marker while Source is active. `Home` / `End`: active
  source range or sequence bounds, labelled by target.
- Direct timecode entry follows the active target. Record validates the project
  timebase and drop/non-drop syntax; Source shows elapsed source time unless
  reliable source timecode metadata exists. Seeking never changes the cut.
- Shortcuts never fire from text inputs, selects, editable content, dialogs,
  retained-draft controls, Pipeline Workbench or active IME composition.

### Smooth precision surface

- Wheel/pinch zoom is centred on the pointer/time under the pointer.
- Shift-wheel or a trackpad horizontal gesture pans the visible source range.
- `Alt` temporarily bypasses snapping; `Shift` provides fine one-frame trim.
- Pointer drag starts only after a small movement threshold. Visual preview is
  updated at most once per animation frame. One durable command is submitted on
  pointer-up through the explicit transaction boundary; Escape/pointer-cancel
  restores the saved range.
- Playhead, trim handles, markers and snap candidates have distinct shape and text
  feedback, not color-only feedback.
- Coarse pointers retain at least 44×44 px targets even when Expert visual density
  is compact.

### Context and feedback

- The Edit Decision Ribbon names both source time and sequence time with tabular
  figures and exposes the active scope.
- `−1/+1` controls become Previous frame/Next frame buttons with consistent SVG
  icons and key hints.
- Save, pending, conflict, lock and source-unavailable states remain visible
  without covering the monitor.
- A keyboard-accessible shortcut sheet groups Transport, Marks, Edit points,
  Timeline and View actions. It is a reference, not a modal tutorial.

### Transaction and protection boundaries

Professional edits cannot depend on the save queue's 400 ms batching window. A
new application-facing `commitTransaction` path:

1. flushes and acknowledges any older queued edit;
2. captures one current base revision and one idempotent request ID;
3. validates the complete command batch locally and at the application boundary;
4. sends it immediately as one request and blocks another transaction until its
   acknowledgement or failure; and
5. publishes one saved result and therefore one existing server history snapshot.

Staged marks, hover, shuttle, compare, zoom and drag previews never enter that
batch. A conflict does not silently rebase: the preview is discarded, staged
marks remain visible as stale, and Apply stays disabled until the user reviews the
new revision. Project switch or disposal fences late acknowledgements from the
new project. Ordinary Inspector fields may retain their current coalesced save
behavior; the transaction API is used only where the UX promises an atomic edit.

Phase 1 preserves the current protection contract rather than treating every
source lock as the same kind of lock:

| Operation                                             | Clip lock           | Library source lock              | Required/selected source                         |
| ----------------------------------------------------- | ------------------- | -------------------------------- | ------------------------------------------------ |
| View, seek, analyze, stage I/O                        | Allowed             | Allowed                          | Allowed                                          |
| Primary clip-local trim, speed or volume              | Blocked             | Allowed by the existing contract | Allowed; source identity remains                 |
| Split flat source media                               | Blocked             | Blocked                          | Allowed; both pieces retain source identity      |
| Overlay audio timing/configuration                    | Blocked             | Blocked                          | Allowed only when existing audio rules permit it |
| Presentation/source-derived changes                   | Blocked             | Blocked                          | Must not remove a required paired source         |
| Delete, replace or remove a required/source identity  | Blocked             | Blocked                          | Blocked                                          |
| Future ripple/roll/slip/slide/insert/overwrite action | Defined per command | Defined per command              | Defined per command                              |

The UI obtains reasons from the same preflight used by the command boundary. It
does not duplicate a looser enablement rule. Unlock is always a separate explicit
command; a professional operation never unlocks content as a side effect.

### Phase 1 acceptance

#### Phase 1A — transport, transaction and timebase (first PR)

1. Source and Record are distinct targets. Record continuously plays a synthetic
   multi-cut Composition across edit points with its supported picture, graphics
   and audible tracks; arbitrary seeks resolve the same active sources regardless
   of seek order.
2. J/K/L, frame/second stepping, primary edit-point navigation, source-only M,
   Record B and direct target-aware timecode work without focus or IME leakage.
3. I/O stages without a write. Apply creates exactly one history entry through an
   acknowledged transaction, survives autosave/reopen as saved Composition state,
   and remains undoable during the active session. Stale/project-switch/cancel and
   each protection-matrix row have application and browser regressions.
4. Version-1 rational timebase round-trips non-drop and valid 29.97/59.94
   drop-frame boundaries, rejects impossible labels, preserves legacy projects
   without dirtying them and does not change render frame rate by display mode.
5. A real synthetic `30000/1001` MP4 is rendered and decoded to verify frame
   count, edit-boundary source identity, duration and audio timing. Drop-frame is
   reported as timeline display semantics rather than falsely claimed as MP4
   picture metadata.

#### Phase 1B — monitor and precision interaction

1. A 1080×1920 project opens with vertical Source/Record frames and correct
   guides; 16:9 and 1:1 select their matching format.
2. The Ribbon exposes unambiguous source and sequence context. Compare restores on
   release, Escape, blur and context switch and never alters saved look/output.
3. Pointer-centred zoom preserves cursor time within one frame; pan, temporary
   snap bypass, pointer cancel and one-transaction trim are deterministic.
4. Pointer feedback targets 60 fps by avoiding per-move persistence and unbounded
   clip scans; automated timing asserts bounded scheduling, not workstation speed.

#### Phase 1C — responsive and accessible completion

1. Layouts at 1024×768, 1440×900 and 1920×1080 have no viewport overflow or
   hidden primary action in English, Traditional Chinese, Japanese and the
   pseudo-locale.
2. Dual-monitor and tabbed-monitor layouts preserve explicit target, focus order,
   44×44 px coarse-pointer targets, screen-reader names and reduced motion.
3. Panel preference corruption, project switching, missing media and reload all
   recover to bounded defaults. General mode retains its guided controls and the
   same saved Composition/history.

## Phase 2 — Typed professional edit semantics

Phase 2 adds commands and tests before exposing their controls:

- preserve and formally document the existing `trim` command as ripple trim at
  the old clip end; do not add a second command with the same behavior;
- add a distinct non-ripple edge trim only if the Composition can represent the
  resulting gap without changing legacy `trim` behavior;
- roll between validated adjacent clips;
- slip source range while preserving sequence duration;
- slide a clip while adjusting validated neighbours;
- multi-selection and atomic batch commands;
- insert and overwrite from a marked source range;
- lift and ripple delete as distinct actions;
- explicit gap handling where the existing track contract permits it;
- linked audio/video selection without pretending unrelated clips are linked.

Every operation declares affected clip/track IDs and before/after timing. Preview
is ephemeral; acceptance creates one Undo entry. Required beats, clip/source locks,
caption bounds, transitions and maximum duration are checked at the command
boundary with an operation-specific matrix. No UI-only timing mutation is
permitted. Batch commands receive explicit transaction IDs; adjacent gestures are
never combined merely because they occur within 400 ms.

## Phase 3 — Tracks, media performance and audio control

- track headers with target, lock, mute, solo and visibility states;
- deterministic track ordering and constrained cross-track moves;
- proxy/optimized-media status, safe toggle and source-hash parity;
- background thumbnail/waveform preparation with cancel/retry and stale fencing;
- dropped-frame and unavailable-proxy feedback without changing output quality;
- a separate bounded Web Audio/native analysis path for live peak metering; the
  existing Audio Quality service remains offline integrated-loudness/true-peak
  evidence and is not misrepresented as a real-time meter;
- J-cuts/L-cuts, fades and role-aware stem review where supported by the current
  audio automation contract.

Project schema changes, if required for durable track state, must be versioned and
migrated independently. Credentials, private media and proxy caches remain outside
portable project data unless explicitly collected.

## Phase 4 — Finishing and verification tools

Phase 4 is a program of separate specifications and PR series, not one completion
checkbox:

- **4A scopes and comparison:** RGB parade/waveform, histogram and vectorscope
  from bounded decoded frames; look bypass and split-wipe with clear
  monitor/output color-boundary labels;
- **4B deterministic animation:** keyframed supported properties and speed ramps
  with arbitrary-seek evaluation and actual-render parity;
- **4C shortcut profiles:** conflict detection and import/export as private
  preferences, never executable project content;
- **4D long-form evidence:** performance telemetry plus workstation evidence for
  proxy, high-DPI, pen/trackpad and multi-channel audio workflows;
- **4E compound editing:** only after a versioned Composition contract proves it
  cannot become a hidden second timeline;
- **4F multicamera:** only with explicit synchronization evidence and source
  provenance.

External LUT admission, HDR display management and hardware monitoring require
separate security/color-management specifications. They are not silently implied
by adding scopes.

## Architecture

Phase 1 factors the existing editor into focused pieces without changing
application ownership:

- pure rational-timecode, Composition-time resolution, shuttle and zoom/pan math
  modules;
- an optional `ProjectTimebaseV1` validated by the project contract while
  retaining legacy `frameRate` compatibility;
- a transport coordinator with named Source and Record adapters, one active target
  and deterministic cancellation on mode, project, source, visibility or focus
  changes;
- a Record presentation adapter driven by the shared sequence resolver and media
  clock; media element state never becomes project state;
- an explicit edit-transaction method alongside the current coalesced Inspector
  save queue;
- `EditDecisionRibbon`, professional transport and shortcut-reference components;
- the existing Precision surface remains the source-range owner;
- TimelineEditor continues to own selected Composition context and submit
  `TimelineCommand` through the current save/history queue.

The final bullet means ownership stays in TimelineEditor; atomic professional
actions use its new transaction method rather than being appended to an unrelated
pending 400 ms batch. Source markers remain in the existing catalog intelligence
boundary. No sequence-marker table is added by implication.

Transient layout preferences use the existing preference boundary or scoped local
storage keys. Saved creative decisions never use local storage. Components that
remain mounted must gate global listeners by active mode and project identity.

Phase 2 adds finite command variants to `@openfilm/solver`, then threads them
through the existing application/HTTP/Desktop boundary. Renderer changes are made
only where the Composition meaning changes and must retain monitor/output parity.

## Testing and evidence

Each phase requires:

- unit tests for timecode, shuttle tiers, edit-point lookup, zoom anchoring,
  snapping modifiers, sequence/source mapping and command validation;
- application/integration tests for locks, stale revision, atomic history,
  autosave, reopen and project switching;
- browser tests for exact keyboard behavior, IME isolation, pointer cancel,
  coarse-pointer targets, reduced motion, responsive layout and all supported
  locales;
- actual FFmpeg regression whenever a saved timing, track, audio or look meaning
  changes;
- full available repository gates before PR review;
- explicit manual gates for real keyboards/trackpads, high-DPI displays, long-form
  playback, color-managed displays and NLE interchange.

Tests must not weaken assertions, use private media or claim hardware performance
from synthetic fixtures.

## Risks and mitigations

| Risk                                          | Mitigation                                                                          |
| --------------------------------------------- | ----------------------------------------------------------------------------------- |
| Global shortcuts edit while typing            | active-mode, dialog, input, contenteditable and IME guards with browser regressions |
| Reverse playback differs by browser           | deterministic frame-stepped reverse shuttle with bounded timer and cancellation     |
| Dragging floods autosave/history              | rAF transient preview; one typed commit on pointer-up; Escape restores snapshot     |
| Professional UI overwhelms casual users       | Cut Desk is Expert presentation; General retains progressive disclosure             |
| New edit semantics violate locks or captions  | command-boundary validation before UI and atomic application tests                  |
| Responsive density hides controls             | measured breakpoints, bounded panels, shortcut alternatives and overflow tests      |
| Preview comparison leaks into output          | comparison state is transient and reset on blur/source/project changes              |
| Source and Record clocks drift                | one monotonic sequence clock, frame-boundary assertions and decoded render evidence |
| Drop-frame labels imply retiming              | rational frame math; display mode cannot alter frame rate or Composition timing     |
| Apply coalesces with another Inspector change | explicit queue barrier, request ID and one-request history regression               |
| Scope grows into an NLE rewrite               | independent phase PRs, explicit acceptance matrix and no second timeline            |

## Delivery sequence

1. Phase 1A: versioned timebase, true Source/Record transport, Composition
   resolution, atomic Apply, edit navigation and keyboard isolation.
2. Phase 1B: project-aspect monitor, Edit Decision Ribbon, compare and smooth
   precision gestures over the Phase 1A transaction boundary.
3. Phase 1C: responsive/resizable Cut Desk, shortcut sheet, accessibility and
   complete validation.
4. Phase 2A–2C: typed trim families, source-to-sequence operations and atomic
   multi-selection.
5. Phase 3: tracks, proxies/performance and audio control.
6. Phase 4: scopes, keyframes and separately approved advanced finishing.

Each item is an independently reviewable PR. A later phase may not be marked
complete because its controls are mocked or because another application can finish
the work.
