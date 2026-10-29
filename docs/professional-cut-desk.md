# Professional Cut Desk — Phase 1A + contextual Phase 1B

Expert mode presents the saved Composition as Record and the existing Precision
editor as Source. General mode retains Story/Precision over the same project,
commands and history. Phase 1A covers transport, transactions and timebase. A
bounded Phase 1B slice adds the Edit Decision Ribbon and diagnostic film-look
comparison. Dual-monitor layout, pointer-centred Precision zoom/pan and later
editing tools remain separate Phase 1B–4 work.

## Time and ownership

Project settings may include `timebase: { version: 1, rateNumerator,
rateDenominator, dropFrame }`. The rational rate is authoritative; `frameRate`
must match its projection. Legacy projects derive an NDF timebase without being
dirtied: rates near 23.976, 29.97 and 59.94 map to their exact NTSC ratios.
New projects choose from finite presets. A populated project can change only
between DF/NDF at the same rational rate; rate conform is not implemented.

DF is valid only at `30000/1001` and `60000/1001`. It changes labels, never media
speed or output frame rate. NDF uses `HH:MM:SS:FF`; DF uses `HH:MM:SS;FF`.
At each minute except every tenth, 29.97 DF omits labels 00–01 and 59.94 DF omits
00–03. Thus `00:01:00;00` is invalid, while `00:01:00;02` is frame 1800 at
29.97 DF. Frame 17982 is `00:10:00;00`. Direct entry rejects invalid labels,
wrong separators and values outside the target bounds; Enter seeks and Escape
restores. No embedded source timecode is invented.

Record owns one monotonic integer sequence clock. Its shared resolver uses the
saved start, duration, source bounds and speed at arbitrary frames; source
selection does not restart playback at edit boundaries. Source owns the selected
media playhead and transient marks. Reliable source-rate metadata drives Source
frame steps; otherwise the elapsed display explicitly labels the project-rate
fallback. Transcript navigation retains supplied segment/word evidence and does
not invent word or frame precision absent from that evidence.

## Keyboard

The labelled target determines ownership. Shortcuts defer to inputs, selects,
editable content, dialogs, retained drafts, Pipeline Workbench and active IME.

| Key                  | Source                                | Record                                 |
| -------------------- | ------------------------------------- | -------------------------------------- |
| Space                | Play/pause source                     | Play/pause Composition                 |
| J / K / L            | Reverse / stop / forward              | Reverse / stop / forward               |
| Left / Right         | One source frame                      | One sequence frame                     |
| Shift + Left / Right | One second at declared rate           | Nominal one-second step                |
| Up / Down            | No Source edit-point shortcut         | Previous/next primary edit boundary    |
| Home / End           | Staged source bounds                  | First/final complete sequence frame    |
| I / O                | Stage source in/out                   | No source mark write                   |
| B                    | Eligible selected source split        | Split resolved primary at Record frame |
| M                    | Source marker in intelligence catalog | Intentionally unsupported              |

Shuttle tiers are bounded to −4, −2, −1, 0, 1, 2, 4. Reverse uses deterministic
frame seeks and pauses/mutes audio; it is not reverse audio playback. Record
markers have no saved contract and M creates neither sequence nor source markers
while Record owns the keyboard.

## Decision context and film-look comparison

The Expert Ribbon reads `Sequence → Beat → Clip → Source` from the current saved
Composition. In Record, Beat/Clip/Source are resolved at the Record frame rather
than copied from the selected Story card, so crossing an edit updates the context
used by split and review. In Source, the selected clip and Precision playhead own
the source context: the sequence clock is explicitly labelled as the selected
clip's **Sequence in**, while Source TC follows the movable Precision playhead.
The Ribbon also shows clip and library source protection, the real Precision
snapping state when applicable and the current save/action status. It is
presentation only and is not another timeline.

When any visual layer at the current Record frame has an effective film look,
**Original (hold)** temporarily removes visual look filters while the pointer,
Space or Enter is held. **Original (lock)** keeps that diagnostic view until it
is toggled, Escape is pressed or the project/revision/timebase/target/active
visual source changes. Pointer cancellation, capture loss, button blur, window
blur and visibility loss always release the momentary state. Blur deliberately
does not clear the explicit latched state. Compare keyboard presses use the same
input, modal, IME and modifier isolation as the rest of the Cut Desk.

Comparison bypasses every current visual layer without changing media resource
ownership, the saved Composition, Undo/Redo, render settings or FFmpeg output.
It does not claim color-managed A/B monitoring; browser color preview remains
approximate and the revision-bound output is authoritative.

## Apply, history and protection

I/O and numeric source-range changes stage session state only. Apply submits one
validated `trim` transaction. Existing trim is ripple trim at the old clip end;
it is not a new non-ripple, roll, slip, slide or insert operation. A shorter film
cannot exclude saved graphics/captions or truncate protected overlays silently.

The explicit transaction flushes older queued edits, captures the current revision
and a fresh idempotent request ID, then sends one command batch. Apply and Record
split each create one Undo step and one Redo step after acknowledgement. Ordinary
Inspector updates retain their existing coalesced queue. Transient marks, seeks,
shuttle and previews create no history. External revisions make marks stale;
selection/project changes clear them. Conflicts reload authoritative state, and
ambiguous acknowledgements retain the existing draft envelope for recovery with
the same request ID. Disposal/project switches fence late results.

Accepted Composition edits survive autosave/reopen. Undo/Redo belongs to the
current application session; opening a project again does not restore its Undo
stack. Named Versions provide separately reviewed durable snapshots. Transaction
receipts are not promised as a portable cross-session Undo log.

| Operation                               | Clip lock         | Library source lock | Required/selected identity      |
| --------------------------------------- | ----------------- | ------------------- | ------------------------------- |
| View, seek, analyze                     | Allowed           | Allowed             | Allowed                         |
| Stage I/O                               | Allowed; no write | Allowed; no write   | No durable change               |
| Primary clip-local trim, speed, volume  | Blocked           | Allowed             | Identity retained               |
| Flat source split                       | Blocked           | Blocked             | Both pieces retain identity     |
| Overlay audio timing/configuration      | Blocked           | Blocked             | Existing audio rules apply      |
| Presentation/source-derived changes     | Blocked           | Blocked             | Required paired source retained |
| Delete/replace/remove required identity | Blocked           | Blocked             | Blocked                         |

The existing command preflight and application boundary enforce the matrix.
Unlocking is always a separate explicit command, never a side effect of Apply.

## Presentation limits and verification

Missing/unavailable sources pause Record with a bounded issue. Current/next banks
pre-arm picture; unready media holds the clock. Decode failures, backgrounding,
project changes and unmount stop/fence playback and late events. Browser audio
elements apply supported clip volume × automation, clamped to their 0–1 volume
range: above-unity gains do not promise FFmpeg loudness parity. The actual FFmpeg
mix remains authoritative. GraphicScene frames are fetched asynchronously and may
lag moving playback; stopped arbitrary seeks verify exact requested frames, not
synchronous per-frame playback throughput. Browser color preview is approximate.

All regression media is locally generated colors, shapes and tones. Projects
contain declarative data; untrusted names remain text, and HTML/JavaScript/remote
GraphicScene properties are rejected. Sources remain byte-identical. See the
Phase 1A [validation record](validation-professional-cut-desk.md) and contextual
Phase 1B [validation record](validation-cut-desk-contextual-ui.md) for commands
and results.
Chromium evidence does not establish physical Windows/macOS keyboard/trackpad,
hardware audio latency, long-form performance, high-DPI or color-managed display
behavior; those manual gates remain open.
