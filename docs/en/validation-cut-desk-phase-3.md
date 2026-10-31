# Professional Cut Desk Phase 3 Track Controls & Persistence — Validation

Date: 2026-10-31.
Capability: Professional track controls (Target track, Lock, Mute, Solo, Visibility) and persistence, operating strictly on the single authoritative `Composition` model without introducing a secondary timeline engine or phantom track state.

## Key Invariants and Contracts

1. **Track Lock Invariant**:
   - When a track has `locked: true`, all editing operations on clips belonging to that track are rejected (Insert, Overwrite, Roll, Slip, Slide, Lift, Trim, Split, Delete, Replace, etc.).
   - Modifying clip lock states on a locked track is rejected (`Track "${track.id}" is locked. Unlock the track before modifying clip locks.`).
   - Clip temporal placements and metadata invariants on locked tracks are preserved intact.

2. **Track Target Semantics and Mutual Exclusion**:
   - Designates the default destination track when an edit command (such as `,` insert or `.` overwrite) does not specify an explicit `trackId`.
   - **Single Target per Track Type Invariant**: Setting `target: true` on a track automatically unsets `target` on all other tracks of the same track type (e.g. video vs. audio), ensuring unambiguous target routing.
   - Allows unsetting target (`target: false`) without affecting other tracks.

3. **Track Visibility Rendering Invariant**:
   - Defaults to visible (`track.visible !== false`).
   - When `visible: false`, clips on that track are omitted from visual layers in `resolveCompositionFrame` and frame compositing loops in `@openfilm/render`. Previews and rendered exports exclude visual pixels from hidden tracks.

4. **Track Mute and Solo Calculation Logic**:
   - **Solo Isolation Semantics**: Evaluated as `const isMuted = track.muted === true || (hasSolo && !track.solo)`.
   - When any track in the sequence has `solo: true`, only soloed tracks that are not muted are playable; all non-soloed tracks are muted.
   - If no track is soloed, all non-muted tracks remain audible.
   - **Mute Precedence**: If a track is both soloed and muted, mute takes precedence and the track remains silent.
   - Consistently applied across `resolveCompositionFrame` (`audible` layers) and `buildAudioMixPlan` (`segments`).

5. **UI & Accessibility (A11y)**:
   - Track header control bar in `TimelineEditor.vue` features fully semantic ARIA attributes (`aria-label`, `aria-pressed`, `role="button"`).
   - High-contrast visual state indicators: Target (blue), Lock (yellow), Mute (red), Solo (amber).
   - History safety: Buttons are disabled while `historyBusy` is active to prevent race conditions.
   - Coarse-pointer target sizing: Touch targets meet the 44×44px minimum requirement under `@media (pointer: coarse)`.

6. **i18n Multi-locale Parity**:
   - 100% key and semantic parity across Traditional Chinese (`zh-TW`), English (`en-US`), and Japanese (`ja-JP`).

7. **Strict Single Timeline Architecture**:
   - All track control states are persisted directly on `Composition.tracks[i]`.
   - No secondary timeline or phantom state engine exists.

## Test Evidence

- `packages/solver/tests/track-controls.test.ts` (18/18 passed):
  - `track.update` command (Target mutual exclusion, Lock, Mute, Solo, Visibility toggling, and boolean validation).
  - Track lock enforcement (rejection of insert, overwrite, roll, slip, slide, lift, trim, split, delete, and clip lock modification).
  - Target track routing (automatic routing for video/audio insert and overwrite).
  - Sequence frame resolution and audio policy mix plan evaluation (visibility filtering, mute, solo isolation, multi-solo, mute precedence).
  - Model schema validation.
- Full contract test suite: 74 test files, 1445 tests passed (`pnpm test:contracts`).
- i18n integrity check: 3017 semantic keys verified (`pnpm test:i18n`).
- TypeScript strict check passed (`pnpm typecheck`).
- ESLint check passed (`pnpm lint`).
- Prettier formatting check passed (`pnpm format:check`).
